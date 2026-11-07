// Command server is the application entry point: schema, backups, tunnel and the web server.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // zone data inside the program: Europe/Kyiv resolves on Windows and minimal images too

	"legkyi/internal/assets"
	"legkyi/internal/config"
	"legkyi/internal/platform"
	"legkyi/internal/registry"
	"legkyi/internal/store"
	"legkyi/internal/system"
	"legkyi/internal/tunnelbin"
	"legkyi/internal/update"
	"legkyi/internal/web"
)

func main() {
	// The log keeps its own record of warnings and errors for the health page (and a file, once the data folder is known).
	logRing = system.NewLogRing(os.Stderr, 400)
	log.SetOutput(logRing)
	relaunch, exe, err := run()
	if err == nil && relaunch {
		// The previous run has closed the database and the tunnel; start the new program in its place.
		err = relaunchProgram(exe)
	}
	if err != nil {
		log.Printf("fatal: %v", err)
		if runtime.GOOS == "windows" { // keep a double-clicked console window readable
			fmt.Print("\nНатисніть Enter, щоб закрити це вікно...")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
		os.Exit(1)
	}
}

// logRing is the writer behind the standard logger (see main).
var logRing *system.LogRing

func run() (relaunch bool, exe string, err error) {
	exe, err = os.Executable() // read once: after an update the running file is gone from this path
	if err != nil {
		return false, exe, err
	}
	relaunch, err = serve(exe)
	return relaunch, exe, err
}

func serve(exe string) (bool, error) {
	appDir := filepath.Dir(exe)
	// Optional .env: the one next to the exe first, then the working directory. Exported variables win,
	// and the first file to define a key wins over later ones.
	cwd, _ := os.Getwd()
	for _, dir := range []string{appDir, cwd} {
		if err := config.LoadEnvFile(filepath.Join(dir, ".env"), os.LookupEnv, func(k, v string) { os.Setenv(k, v) }); err != nil {
			log.Printf("warning: reading .env: %v", err)
		}
	}
	cfg, err := config.Load(os.Getenv, appDir)
	if err != nil {
		return false, err
	}
	if os.Getenv("LEGKYI_DATA_DIR") == "" && cfg.DataDir != appDir {
		log.Printf("WARNING: %s is not writable, so data (database, backups, secret) is kept in %s instead. Move the program to a writable folder to keep everything next to it.", appDir, cfg.DataDir)
	}
	restrictFiles(cfg.DataDir, cfg.BackupsDir)
	// Warnings and errors also go to <data>/logs/legkyi.log (about 1 MB, one rotation), so they survive a restart.
	if err := logRing.AttachFile(filepath.Join(cfg.DataDir, "logs", "legkyi.log"), 1<<20); err != nil {
		log.Printf("warning: the error log is kept in memory only: %v", err)
	}
	defer logRing.Close()
	journal := config.JournalMode(cfg.JournalWant, cfg.DataDir, runtime.GOOS, "/proc/mounts")
	if err := os.MkdirAll(cfg.BackupsDir, 0o755); err != nil {
		log.Printf("[STORAGE WARNING] backups directory %s: %v", cfg.BackupsDir, err)
	}
	fmt.Printf("Data folder: %s\nBackups: %s\nDatabase: %s (journal: %s)\nhttp://%s:%s\n",
		cfg.DataDir, cfg.BackupsDir, cfg.DBPath(), journal, cfg.Host, cfg.Port)

	st, err := store.Open(cfg.DBPath(), journal)
	if err != nil {
		return false, err
	}
	defer st.Close()

	// integrity check (log only), schema, roles + first admin, backup, loop.
	if verdict, err := st.IntegrityCheck(); err != nil || verdict != "ok" {
		log.Printf("DATABASE INTEGRITY CHECK FAILED: %v %s. Restore the newest backup from the backups folder.", err, verdict)
	}
	if err := st.EnsureSchema(); err != nil {
		return false, err
	}
	if err := seed(st); err != nil {
		return false, err
	}
	backups := &store.Backups{Store: st, Dir: cfg.BackupsDir, Keep: cfg.BackupKeep}
	if _, err := backups.Run(""); err != nil {
		log.Printf("startup backup failed: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	loopDone := make(chan struct{})
	go func() {
		defer close(loopDone)
		backupLoop(ctx, backups, time.Duration(cfg.BackupEveryM)*time.Minute)
	}()

	secret, err := web.LoadSecret(os.Getenv, cfg.DataDir)
	if err != nil {
		return false, err
	}
	restartc := make(chan struct{}, 1)
	updater := &update.Updater{
		Exe: exe, Build: update.Current(), Auto: boolEnv("AUTO_UPDATE", true),
		Backup: func() error { _, err := backups.Run("before-update"); return err },
		Restart: func() {
			select {
			case restartc <- struct{}{}:
			default:
			}
		},
	}
	updater.Repo = strings.TrimSpace(os.Getenv("UPDATE_REPO"))
	if api := strings.TrimSpace(os.Getenv("UPDATE_API_URL")); api != "" { // for tests: a fake GitHub on this machine
		if u, err := url.Parse(api); err == nil && (u.Scheme == "https" || u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost") {
			updater.API, updater.AllowHTTP = api, u.Scheme == "http"
		}
	}
	if updater.Enabled() && updater.Auto {
		log.Printf("auto-update is on (build %s); AUTO_UPDATE=0 turns it off", updater.Build.Tag)
	}
	go updater.Loop(ctx, 10*time.Minute, time.Duration(max(1, atoiEnv("AUTO_UPDATE_CHECK_HOURS", 6)))*time.Hour)
	tun := &system.Tunnel{Root: cfg.DataDir, Port: cfg.Port, EnableByDefault: tunnelbin.Bundled}
	if tunnelbin.Bundled {
		tun.Bundled = tunnelbin.Extract
	}
	if started := tun.StartIfEnabled(); started != nil {
		if started.State == "error" {
			log.Printf("tunnel did not start: %s", started.Error)
		} else {
			go announceTunnel(ctx, tun)
		}
	}
	var access *web.AccessConfig
	if team, aud := strings.TrimSpace(os.Getenv("CF_ACCESS_TEAM_DOMAIN")), strings.TrimSpace(os.Getenv("CF_ACCESS_AUD")); team != "" && aud != "" {
		access = &web.AccessConfig{TeamDomain: strings.TrimPrefix(strings.TrimSuffix(team, "/"), "https://"), Audience: aud}
		log.Printf("Cloudflare Access is enforced for requests that come through the tunnel (team %s)", access.TeamDomain)
		if strings.TrimSpace(os.Getenv("TUNNEL_TOKEN")) == "" {
			log.Printf("WARNING: Cloudflare Access is on but there is no TUNNEL_TOKEN. A quick tunnel (trycloudflare.com) cannot be put behind Access, so all tunnel traffic will be refused. Use a named tunnel with your own domain.")
		}
	}
	// Web Push key pair: created once in the data folder (vapid.key, 0600) or taken from VAPID_PRIVATE_KEY. Without
	// it the bell still works in the open app, but nothing reaches a closed one.
	var pusher *platform.PushSender
	if vapid, err := platform.LoadVAPIDKey(os.Getenv, cfg.DataDir); err != nil {
		log.Printf("Web Push is off: %v", err)
	} else {
		pusher = &platform.PushSender{Key: vapid, Subject: orEnv("VAPID_SUBJECT", "https://github.com/alsesd/easymourningreport")}
	}
	deps := web.Deps{Access: access, Push: pusher, Logs: logRing,
		Store: st, Assets: assets.FS(), Registry: registry.Installed(), Secret: secret, Backups: backups,
		BackupEveryMin: cfg.BackupEveryM, Tunnel: tun,
		CookieSecure: os.Getenv("COOKIE_SECURE") == "1",
		PasskeyRPID:  strings.TrimSpace(os.Getenv("PASSKEY_RP_ID")), Updater: updater,
		// Only the local cloudflared may set the client address (X-Forwarded-For).
		Trusted: web.ParseTrustedHosts(orEnv("FORWARDED_ALLOW_IPS", "127.0.0.1")),
	}
	handler := web.New(deps)
	// Background jobs (the modules' daily reminders, notification pruning).
	// REMINDER_AT is "HH:MM" in APP_TIMEZONE (default 14:30, Europe/Kyiv); "off" disables the reminder.
	pushDone := make(chan struct{})
	go func() {
		defer close(pushDone)
		web.RunPushDispatcher(ctx, deps)
	}()
	schedDone := make(chan struct{})
	go func() {
		defer close(schedDone)
		web.RunScheduler(ctx, deps, schedulerConfig())
	}()
	srv := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, cfg.Port),
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       2 * time.Minute, // bodies and Excel uploads; no WriteTimeout: backup downloads stream a whole database
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}
	ln, err := listen(srv.Addr, os.Getenv("LEGKYI_RESTARTED") == "1")
	if err != nil {
		return false, err
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	var serveErr error
	relaunch := false
	select {
	case <-ctx.Done():
	case serveErr = <-errc:
	case <-restartc:
		relaunch = true
		log.Printf("the program was updated; restarting")
	}
	// Shutdown order: HTTP, tunnel, loop, checkpoint, final backup.
	// Windows gives a closing console about 5 s: finish in-flight requests quickly so the
	// checkpoint and the final backup still run.
	sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
	tun.Shutdown()
	stop()
	<-loopDone
	<-schedDone
	<-pushDone
	if err := st.Checkpoint(); err != nil {
		log.Printf("checkpoint failed: %v", err)
	}
	if _, err := backups.Run(""); err != nil {
		log.Printf("final backup failed: %v", err)
	}
	if errors.Is(serveErr, http.ErrServerClosed) {
		serveErr = nil
	}
	return relaunch && serveErr == nil, serveErr
}

// listen binds the port. A program that was just updated retries for a few seconds: the previous process
// may still be closing its listener.
func listen(addr string, retry bool) (net.Listener, error) {
	deadline := time.Now().Add(15 * time.Second)
	for {
		ln, err := net.Listen("tcp", addr)
		if err == nil || !retry || time.Now().After(deadline) {
			return ln, err
		}
		time.Sleep(300 * time.Millisecond)
	}
}

func boolEnv(k string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(k))) {
	case "0", "false", "no", "off":
		return false
	case "1", "true", "yes", "on":
		return true
	}
	return def
}

func atoiEnv(k string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(k))); err == nil {
		return n
	}
	return def
}

func seed(st *store.Store) error {
	tx, err := st.W.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := platform.Seed(tx, os.Getenv, os.Stdout, time.Now(), registry.Installed().Seeds()...); err != nil {
		return err
	}
	return tx.Commit()
}

func backupLoop(ctx context.Context, b *store.Backups, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := b.Run(""); err != nil {
				log.Printf("Scheduled database backup failed: %v", err)
			}
		}
	}
}

func orEnv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// announceTunnel prints the public address once the tunnel is up (up to about 90 s).
func announceTunnel(ctx context.Context, tun *system.Tunnel) {
	for i := 0; i < 90; i++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
		st := tun.Status()
		if st.State == "error" {
			log.Printf("tunnel error: %s", st.Error)
			return
		}
		if st.State == "running" && st.PublicURL != "" {
			fmt.Printf("\nПублічна адреса: %s\n\n", st.PublicURL)
			return
		}
	}
	log.Printf("tunnel is still starting; see Адміністрування → Система")
}

// schedulerConfig reads the reminder time and the zone it is evaluated in. The zone is explicit because the
// program often runs on a machine set to UTC while the desks work on Kyiv time.
func schedulerConfig() web.SchedulerConfig {
	cfg := web.SchedulerConfig{ReminderAt: strings.TrimSpace(orEnv("REMINDER_AT", "14:30"))}
	if strings.EqualFold(cfg.ReminderAt, "off") {
		cfg.ReminderAt = ""
	}
	name := strings.TrimSpace(orEnv("APP_TIMEZONE", "Europe/Kyiv"))
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("APP_TIMEZONE %q is not a known time zone (%v): using the machine's local time", name, err)
		loc = time.Local
	}
	cfg.Loc = loc
	return cfg
}
