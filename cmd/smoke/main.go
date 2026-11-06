// Command smoke starts a built single-file executable in an empty folder and checks that it works:
// the web server and UI answer, an administrator can sign in, every file is created next to the
// program, and (with -tunnel) cloudflared is started from the embedded copy and stops with the app.
//
//	go run ./cmd/smoke -exe dist/legkyi.exe [-tunnel] [-update]
//
// With -update the program (which must be a stamped release build, scripts/build_go.sh with LEGKYI_VERSION) is
// pointed at a fake GitHub on this machine that offers the very same file as a newer release; the smoke test
// installs it through the admin API and checks the backup, the file swap, the restart and that the session survives.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func main() {
	exe := flag.String("exe", "", "path of the executable to test")
	tunnel := flag.Bool("tunnel", false, "also test the bundled cloudflared (needs no network access)")
	updateTest := flag.Bool("update", false, "also test a self-update against a fake GitHub (needs a stamped release build)")
	flag.Parse()
	if *exe == "" {
		fmt.Fprintln(os.Stderr, "usage: smoke -exe <path> [-tunnel] [-update]")
		os.Exit(2)
	}
	if err := run(*exe, *tunnel, *updateTest); err != nil {
		fmt.Fprintln(os.Stderr, "SMOKE FAILED:", err)
		os.Exit(1)
	}
	fmt.Println("SMOKE OK")
}

func step(format string, a ...any) { fmt.Printf("• "+format+"\n", a...) }

func run(exe string, tunnel, updateTest bool) error {
	src, err := os.ReadFile(exe)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "legkyi-smoke-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	target := filepath.Join(dir, filepath.Base(exe))
	if err := os.WriteFile(target, src, 0o755); err != nil {
		return err
	}
	port, err := freePort()
	if err != nil {
		return err
	}
	enabled := "0"
	if tunnel {
		enabled = "1"
	}
	// CRLF and a BOM on purpose: this is what Notepad produces.
	env := "\xef\xbb\xbfADMIN_PASSWORD=smoke-pass\r\nPORT=" + port + "\r\nTUNNEL_ENABLED=" + enabled + "\r\n"
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(env), 0o644); err != nil {
		return err
	}

	logPath := filepath.Join(dir, "console.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd := exec.Command(target)
	cmd.Dir = dir
	cmd.Stdout, cmd.Stderr = logFile, logFile
	cmd.Stdin = nil
	cmd.Env = append(cleanEnv(), "AUTO_UPDATE=0") // a stamped CI build must never update itself during a test
	var fake *fakeGitHub
	if updateTest {
		var err error
		if fake, err = startFakeGitHub(src, filepath.Base(exe)); err != nil {
			return err
		}
		defer fake.close()
		cmd.Env = append(cmd.Env, "UPDATE_API_URL="+fake.url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
		}
	}()
	fail := func(err error) error {
		b, _ := os.ReadFile(logPath)
		return fmt.Errorf("%w\n--- console output ---\n%s", err, b)
	}

	base := "http://127.0.0.1:" + port
	step("waiting for %s/healthz", base)
	if err := waitFor(func() bool { return get(base+"/healthz") == 200 }, 60*time.Second, exited); err != nil {
		return fail(fmt.Errorf("server did not become healthy: %w", err))
	}

	step("UI and PWA files are served from the embedded copy")
	if body, code := getBody(base + "/"); code != 200 || !strings.Contains(body, `id="root"`) {
		return fail(fmt.Errorf("GET / = %d, no app root in the page", code))
	}
	for _, p := range []string{"/manifest.webmanifest", "/sw.js", "/offline", "/static/icon-192.png"} {
		if c := get(base + p); c != 200 {
			return fail(fmt.Errorf("GET %s = %d", p, c))
		}
	}

	step("administrator can sign in (password from .env with BOM + CRLF)")
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	req, _ := http.NewRequest("POST", base+"/api/v1/auth/login", bytes.NewReader([]byte(`{"login":"admin","password":"smoke-pass"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err := client.Do(req)
	if err != nil {
		return fail(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		return fail(fmt.Errorf("login = %d", resp.StatusCode))
	}
	sess, err := client.Get(base + "/api/v1/session")
	if err != nil {
		return fail(err)
	}
	var s struct {
		Login string `json:"login"`
	}
	_ = json.NewDecoder(sess.Body).Decode(&s)
	sess.Body.Close()
	if s.Login != "admin" {
		return fail(fmt.Errorf("session login = %q", s.Login))
	}

	if updateTest {
		step("self-update through the admin API (fake GitHub on %s)", fake.url)
		if err := checkUpdate(client, base, dir, target, cmd, logPath); err != nil {
			return fail(err)
		}
	}

	step("data files are next to the program")
	for _, f := range []string{"reports.db", "secret.key", "backups"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			return fail(fmt.Errorf("missing %s next to the program: %w", f, err))
		}
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "backups", "*.db")); len(m) == 0 {
		return fail(fmt.Errorf("no startup backup in backups/"))
	}

	if tunnel {
		step("bundled cloudflared is extracted and started")
		var bin string
		if err := waitFor(func() bool {
			m, _ := filepath.Glob(filepath.Join(dir, "tunnel", "cloudflared-*"))
			for _, f := range m {
				if !strings.HasSuffix(f, ".log") {
					bin = f
					return true
				}
			}
			return false
		}, 30*time.Second, exited); err != nil {
			return fail(fmt.Errorf("cloudflared was not extracted into tunnel/: %w", err))
		}
		if err := waitFor(func() bool { _, e := os.Stat(filepath.Join(dir, "tunnel", "cloudflared.log")); return e == nil }, 15*time.Second, exited); err != nil {
			return fail(fmt.Errorf("cloudflared was not started: %w", err))
		}
		step("extracted %s", filepath.Base(bin))
		if err := checkChildStops(cmd, exited, filepath.Base(bin)); err != nil {
			return fail(err)
		}
		return nil
	}

	step("graceful stop")
	if updateTest && runtime.GOOS == "windows" {
		return killReplacement(filepath.Base(exe)) // the replacement is a new process this harness did not start
	}
	return stop(cmd, exited, false)
}

// checkChildStops ends the app the hard way on Windows (End Task: the job object must take cloudflared
// down) and gracefully elsewhere, then verifies that no process with the cloudflared image remains.
func checkChildStops(cmd *exec.Cmd, exited chan struct{}, image string) error {
	hard := runtime.GOOS == "windows"
	step("stopping the app (%s) and checking that cloudflared goes with it", map[bool]string{true: "forced kill", false: "SIGTERM"}[hard])
	if err := stop(cmd, exited, hard); err != nil {
		return err
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if !processRunning(image) {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("%s is still running after the app stopped", image)
}

func stop(cmd *exec.Cmd, exited chan struct{}, hard bool) error {
	var err error
	if hard || runtime.GOOS == "windows" {
		err = cmd.Process.Kill()
	} else {
		err = cmd.Process.Signal(os.Interrupt)
	}
	if err != nil {
		return err
	}
	select {
	case <-exited:
		return nil
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		return fmt.Errorf("the app did not stop")
	}
}

func processRunning(image string) bool {
	if runtime.GOOS == "windows" {
		out, _ := exec.Command("tasklist", "/FI", "IMAGENAME eq "+image, "/NH").Output()
		return strings.Contains(strings.ToLower(string(out)), strings.ToLower(image))
	}
	out, _ := exec.Command("pgrep", "-f", image).Output()
	return strings.TrimSpace(string(out)) != ""
}

func waitFor(ok func() bool, d time.Duration, exited chan struct{}) error {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			return fmt.Errorf("the program exited")
		default:
		}
		if ok() {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("timed out after %s", d)
}

func get(url string) int { _, c := getBody(url); return c }

func getBody(url string) (string, int) {
	c := &http.Client{Timeout: 5 * time.Second}
	r, err := c.Get(url)
	if err != nil {
		return "", 0
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return string(b), r.StatusCode
}

func freePort() (string, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	defer l.Close()
	_, p, _ := net.SplitHostPort(l.Addr().String())
	return p, nil
}

// cleanEnv drops settings of the developer's shell that would leak into the test.
func cleanEnv() []string {
	var out []string
	for _, kv := range os.Environ() {
		k := strings.ToUpper(strings.SplitN(kv, "=", 2)[0])
		switch k {
		case "ADMIN_PASSWORD", "PORT", "HOST", "TUNNEL_TOKEN", "TUNNEL_ENABLED", "LEGKYI_DATA_DIR", "LEGKYI_BACKUPS_DIR", "CLOUDFLARED_PATH", "DEMO", "SECRET_KEY", "AUTO_UPDATE":
			continue
		}
		out = append(out, kv)
	}
	return out
}
