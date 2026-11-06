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
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"legkyi/internal/assets"
	"legkyi/internal/config"
	"legkyi/internal/platform"
	"legkyi/internal/registry"
	"legkyi/internal/store"
	"legkyi/internal/system"
	"legkyi/internal/tunnelbin"
	"legkyi/internal/web"
)

func main() {
	if err := run(); err != nil {
		log.Printf("fatal: %v", err)
		if runtime.GOOS == "windows" { // keep a double-clicked console window readable
			fmt.Print("\nНатисніть Enter, щоб закрити це вікно...")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
		os.Exit(1)
	}
}

func run() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
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
		return err
	}
	if os.Getenv("LEGKYI_DATA_DIR") == "" && cfg.DataDir != appDir {
		log.Printf("WARNING: %s is not writable, so data (database, backups, secret) is kept in %s instead. Move the program to a writable folder to keep everything next to it.", appDir, cfg.DataDir)
	}
	restrictFiles(cfg.DataDir, cfg.BackupsDir)
	journal := config.JournalMode(cfg.JournalWant, cfg.DataDir, runtime.GOOS, "/proc/mounts")
	if err := os.MkdirAll(cfg.BackupsDir, 0o755); err != nil {
		log.Printf("[STORAGE WARNING] backups directory %s: %v", cfg.BackupsDir, err)
	}
	fmt.Printf("Data folder: %s\nBackups: %s\nDatabase: %s (journal: %s)\nhttp://%s:%s\n",
		cfg.DataDir, cfg.BackupsDir, cfg.DBPath(), journal, cfg.Host, cfg.Port)

	st, err := store.Open(cfg.DBPath(), journal)
	if err != nil {
		return err
	}
	defer st.Close()

	// integrity check (log only), schema, roles + first admin, backup, loop.
	if verdict, err := st.IntegrityCheck(); err != nil || verdict != "ok" {
		log.Printf("DATABASE INTEGRITY CHECK FAILED: %v %s. Restore the newest backup from the backups folder.", err, verdict)
	}
	if err := st.EnsureSchema(); err != nil {
		return err
	}
	if err := seed(st); err != nil {
		return err
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
		return err
	}
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
	handler := web.New(web.Deps{
		Store: st, Assets: assets.FS(), Registry: registry.Installed(), Secret: secret, Backups: backups,
		BackupEveryMin: cfg.BackupEveryM, Tunnel: tun,
		CookieSecure: os.Getenv("COOKIE_SECURE") == "1",
		PasskeyRPID:  strings.TrimSpace(os.Getenv("PASSKEY_RP_ID")),
		// Only the local cloudflared may set the client address (X-Forwarded-For).
		Trusted: web.ParseTrustedHosts(orEnv("FORWARDED_ALLOW_IPS", "127.0.0.1")),
	})
	srv := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, cfg.Port),
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       2 * time.Minute, // bodies and Excel uploads; no WriteTimeout: backup downloads stream a whole database
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()

	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-errc:
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
	if err := st.Checkpoint(); err != nil {
		log.Printf("checkpoint failed: %v", err)
	}
	if _, err := backups.Run(""); err != nil {
		log.Printf("final backup failed: %v", err)
	}
	if errors.Is(serveErr, http.ErrServerClosed) {
		serveErr = nil
	}
	return serveErr
}

func seed(st *store.Store) error {
	tx, err := st.W.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := platform.Seed(tx, registry.Installed().DefaultGrants(), os.Getenv, os.Stdout, time.Now(), registry.Installed().Seeds()...); err != nil {
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
