// Package system runs the parts of the server that live outside the database: the Cloudflare
// Tunnel child process and the health report.
package system

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
)

// TunnelStatus is the JSON shape of GET /admin/tunnel.
type TunnelStatus struct {
	Enabled   bool   `json:"enabled"`
	Autostart bool   `json:"autostart"`
	HasToken  bool   `json:"has_token"`
	State     string `json:"state"` // disabled, stopped, starting, running, error
	PublicURL string `json:"public_url"`
	Error     string `json:"error"`
}

// Tunnel supervises one cloudflared child process. State lives in Root: tunnel/token (0600),
// tunnel/cloudflared.log and the .tunnel-enabled marker that restarts it with the app.
type Tunnel struct {
	Root     string
	Getenv   func(string) string
	LookPath func(string) (string, error)
	// Bundled extracts the cloudflared that is embedded in the executable into the given folder and
	// returns its path (nil when the build does not contain one).
	Bundled func(dir string) (string, error)
	// EnableByDefault turns the tunnel on once at the first start (bundled single-file builds), after
	// which the saved preference and the admin page decide. TUNNEL_ENABLED=0 still wins.
	EnableByDefault bool
	MetricsAddr     string // cloudflared's local metrics endpoint
	Port            string // the port the app listens on, for quick tunnels

	mu   sync.Mutex
	proc *child
}

// child is one started process. A single goroutine waits for it, so Wait is called exactly once.
type child struct {
	cmd  *exec.Cmd
	log  *os.File
	done chan struct{}
	code int
}

const defaultMetrics = "127.0.0.1:20241"

func (t *Tunnel) env(k string) string {
	if t.Getenv != nil {
		return t.Getenv(k)
	}
	return os.Getenv(k)
}

func (t *Tunnel) metricsAddr() string {
	if t.MetricsAddr != "" {
		return t.MetricsAddr
	}
	return defaultMetrics
}

func (t *Tunnel) stateDir() string {
	dir := filepath.Join(t.Root, "tunnel")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

// marker returns the autostart marker path, migrating the one older releases wrote.
func (t *Tunnel) marker() string {
	marker := filepath.Join(t.Root, ".tunnel-enabled")
	legacy := filepath.Join(t.Root, ".tailscale-funnel-enabled")
	if _, err := os.Stat(legacy); err == nil {
		if _, err := os.Stat(marker); err != nil {
			_ = os.Rename(legacy, marker)
		} else {
			_ = os.Remove(legacy)
		}
	}
	return marker
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

func (t *Tunnel) tokenFile() string { return filepath.Join(t.stateDir(), "token") }

func (t *Tunnel) savedToken() string {
	b, err := os.ReadFile(t.tokenFile())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// token: TUNNEL_TOKEN wins over the one saved from the admin page.
func (t *Tunnel) token() string {
	if v := strings.TrimSpace(t.env("TUNNEL_TOKEN")); v != "" {
		return v
	}
	return t.savedToken()
}

func (t *Tunnel) saveToken(token string) error {
	path := t.tokenFile()
	if err := os.WriteFile(path, []byte(token), 0o600); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		return os.Chmod(path, 0o600) // WriteFile keeps the mode of an existing file
	}
	return nil
}

// binary: a set CLOUDFLARED_PATH must point at a file (no fallback then); otherwise the bundled
// copy, then cloudflared from PATH.
func (t *Tunnel) binary() string {
	if override := strings.TrimSpace(t.env("CLOUDFLARED_PATH")); override != "" {
		if fileExists(override) {
			return override
		}
		return ""
	}
	if t.Bundled != nil {
		p, err := t.Bundled(t.stateDir())
		if err == nil {
			return p
		}
		log.Printf("bundled cloudflared could not be extracted: %v", err)
	}
	look := t.LookPath
	if look == nil {
		look = exec.LookPath
	}
	p, err := look("cloudflared")
	if err != nil {
		return ""
	}
	return p
}

var metricsClient = &http.Client{Timeout: 500 * time.Millisecond}

func (t *Tunnel) metrics(path string, into any) bool {
	resp, err := metricsClient.Get("http://" + t.metricsAddr() + path)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(into) == nil
}

// lastLogLine prefers the last line mentioning an error, else the last non-empty line; at most 300 runes.
func (t *Tunnel) lastLogLine() string {
	b, err := os.ReadFile(filepath.Join(t.stateDir(), "cloudflared.log"))
	if err != nil {
		return ""
	}
	var errs, all []string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		all = append(all, line)
		if strings.Contains(line, "ERR") || strings.Contains(strings.ToLower(line), "error") {
			errs = append(errs, line)
		}
	}
	pick := all
	if len(errs) > 0 {
		pick = errs
	}
	if len(pick) == 0 {
		return ""
	}
	r := []rune(pick[len(pick)-1])
	if len(r) > 300 {
		r = r[len(r)-300:]
	}
	return string(r)
}

// Status never blocks on the process; it asks the metrics endpoint when the child is alive.
func (t *Tunnel) Status() TunnelStatus {
	autostart := fileExists(t.marker())
	res := TunnelStatus{HasToken: t.token() != "", State: "disabled"}
	res.Autostart = autostart
	if autostart {
		res.State = "stopped"
	}
	t.mu.Lock()
	p := t.proc
	t.mu.Unlock()
	if p == nil {
		return res
	}
	select {
	case <-p.done:
		res.State = "error"
		res.Error = t.lastLogLine()
		if res.Error == "" {
			res.Error = fmt.Sprintf("cloudflared завершився з кодом %d.", p.code)
		}
		return res
	default:
	}
	res.Enabled = true
	var ready struct {
		ReadyConnections int `json:"readyConnections"`
	}
	t.metrics("/ready", &ready)
	res.State = "starting"
	if ready.ReadyConnections > 0 {
		res.State = "running"
	}
	var quick struct {
		Hostname string `json:"hostname"`
	}
	t.metrics("/quicktunnel", &quick)
	if quick.Hostname != "" {
		res.PublicURL = "https://" + quick.Hostname
	} else if res.State == "running" {
		res.PublicURL = strings.TrimSpace(t.env("PUBLIC_URL"))
	}
	return res
}

// SetAutostart writes or removes the marker and returns the new status.
func (t *Tunnel) SetAutostart(enabled bool) TunnelStatus {
	t.writeAutostart(enabled)
	return t.Status()
}

func (t *Tunnel) writeAutostart(enabled bool) {
	marker := t.marker()
	if enabled {
		_ = os.WriteFile(marker, []byte("enabled\n"), 0o644)
	} else {
		_ = os.Remove(marker)
	}
}

func (t *Tunnel) failed(msg string) TunnelStatus {
	s := t.Status()
	s.State, s.Error = "error", msg
	return s
}

// Start launches cloudflared, restarting it when a new token is supplied. Failures come back as a
// status with State "error"; the autostart preference is applied even then.
func (t *Tunnel) Start(token string, autostart bool) TunnelStatus {
	supplied := strings.TrimSpace(token)
	if strings.IndexFunc(supplied, unicode.IsSpace) >= 0 {
		return t.failed("Токен тунелю не може містити пробілів чи переносів рядка.")
	}
	t.mu.Lock()
	if supplied != "" {
		if err := t.saveToken(supplied); err != nil {
			t.mu.Unlock()
			return t.failed("Не вдалося зберегти токен: " + err.Error())
		}
	}
	t.writeAutostart(autostart)
	if t.proc != nil && !t.proc.exited() {
		if supplied == "" {
			t.mu.Unlock()
			return t.Status()
		}
		t.stopLocked()
	}
	bin := t.binary()
	if bin == "" {
		t.mu.Unlock()
		return t.failed("cloudflared не встановлено на цьому сервері.")
	}
	args := []string{"tunnel", "--no-autoupdate", "--metrics", t.metricsAddr()}
	if run := t.token(); run != "" {
		args = append(args, "run", "--token", run)
	} else {
		port := t.Port
		if port == "" {
			port = "8000"
		}
		args = append(args, "--url", "http://127.0.0.1:"+port)
	}
	t.closeLogLocked()
	logFile, err := os.Create(filepath.Join(t.stateDir(), "cloudflared.log"))
	if err != nil {
		t.mu.Unlock()
		return t.failed("Не вдалося запустити cloudflared: " + err.Error())
	}
	cmd := exec.Command(bin, args...)
	cmd.Stdout, cmd.Stderr = logFile, logFile
	if err := cmd.Start(); err != nil {
		logFile.Close()
		t.mu.Unlock()
		return t.failed("Не вдалося запустити cloudflared: " + err.Error())
	}
	bindToLifetime(cmd) // Windows: cloudflared dies with the app even if the app is killed
	c := &child{cmd: cmd, log: logFile, done: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		c.code = cmd.ProcessState.ExitCode()
		close(c.done)
	}()
	t.proc = c
	t.mu.Unlock()
	return t.Status()
}

func (c *child) exited() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

// Stop disconnects now; the autostart preference stays.
func (t *Tunnel) Stop() TunnelStatus {
	t.mu.Lock()
	t.stopLocked()
	t.mu.Unlock()
	return t.Status()
}

// StartIfEnabled is the startup rule: TUNNEL_ENABLED=0 wins, then TUNNEL_ENABLED=1 or TUNNEL_TOKEN,
// then the saved preference.
func (t *Tunnel) StartIfEnabled() *TunnelStatus {
	t.applyDefault()
	switch strings.ToLower(strings.TrimSpace(t.env("TUNNEL_ENABLED"))) {
	case "0", "false", "no", "off":
		return nil
	case "1", "true", "yes", "on":
	default:
		if strings.TrimSpace(t.env("TUNNEL_TOKEN")) == "" && !fileExists(t.marker()) {
			return nil
		}
	}
	s := t.Start("", true)
	return &s
}

// applyDefault writes the autostart marker once on the very first start of a bundled build, unless
// TUNNEL_ENABLED turns the tunnel off. A sentinel keeps it from overriding the admin's later choice.
func (t *Tunnel) applyDefault() {
	if !t.EnableByDefault {
		return
	}
	sentinel := filepath.Join(t.Root, ".tunnel-default-applied")
	if fileExists(sentinel) {
		return
	}
	switch strings.ToLower(strings.TrimSpace(t.env("TUNNEL_ENABLED"))) {
	case "0", "false", "no", "off":
		return // not recorded: removing the setting later still gives the default once
	}
	t.writeAutostart(true)
	_ = os.WriteFile(sentinel, []byte("1"), 0o644)
}

// Shutdown stops the child; call it before the final backup.
func (t *Tunnel) Shutdown() { t.Stop() }

func (t *Tunnel) stopLocked() {
	if c := t.proc; c != nil && !c.exited() {
		if err := c.cmd.Process.Signal(syscall.SIGTERM); err != nil {
			_ = c.cmd.Process.Kill() // Windows has no SIGTERM
		}
		select {
		case <-c.done:
		case <-time.After(5 * time.Second):
			_ = c.cmd.Process.Kill()
			<-c.done
		}
	}
	t.closeLogLocked()
	t.proc = nil
}

// closeLogLocked closes the log of the previous child (the open handle is kept by the process
// until it exits, so this runs after a stop or before a new start).
func (t *Tunnel) closeLogLocked() {
	if c := t.proc; c != nil && c.log != nil {
		_ = c.log.Close()
		c.log = nil
	}
}
