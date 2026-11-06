package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

const fakeCloudflared = "#!/bin/sh\necho \"args: $* env-token: $TUNNEL_TOKEN\"\nexec sleep 30\n"
const failingCloudflared = "#!/bin/sh\necho \"2026-11-05T10:00:00Z ERR Provided Tunnel token is not valid\"\nexit 1\n"

type fixture struct {
	t       *testing.T
	root    string
	env     map[string]string
	metrics map[string]any // path -> JSON body; absent paths answer 404
	tun     *Tunnel
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh scripts as cloudflared")
	}
	f := &fixture{t: t, root: t.TempDir(), env: map[string]string{}, metrics: map[string]any{}}
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		body, ok := f.metrics[r.URL.Path]
		mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	f.tun = &Tunnel{Root: f.root, Getenv: func(k string) string { return f.env[k] }, MetricsAddr: strings.TrimPrefix(srv.URL, "http://"), Port: "8123",
		LookPath: func(string) (string, error) { return "", os.ErrNotExist }}
	t.Cleanup(f.tun.Shutdown)
	return f
}

func (f *fixture) binary(script string) {
	p := filepath.Join(f.root, "cloudflared")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		f.t.Fatal(err)
	}
	f.env["CLOUDFLARED_PATH"] = p
}

func (f *fixture) logText() string {
	b, _ := os.ReadFile(filepath.Join(f.root, "tunnel", "cloudflared.log"))
	return string(b)
}

func (f *fixture) waitLog(want string) {
	f.t.Helper()
	for i := 0; i < 100; i++ {
		if strings.Contains(f.logText(), want) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	f.t.Fatalf("log lacks %q: %q", want, f.logText())
}

func TestDisabledByDefault(t *testing.T) {
	f := newFixture(t)
	if got := f.tun.Status(); got != (TunnelStatus{State: "disabled"}) {
		t.Fatalf("%+v", got)
	}
	if f.tun.StartIfEnabled() != nil {
		t.Fatal("must not start by default")
	}
}

func TestAutostartMarkerAndLegacyMarker(t *testing.T) {
	f := newFixture(t)
	if !f.tun.SetAutostart(true).Autostart || f.tun.Status().State != "stopped" {
		t.Fatal("autostart on")
	}
	if f.tun.SetAutostart(false).Autostart {
		t.Fatal("autostart off")
	}
	os.WriteFile(filepath.Join(f.root, ".tailscale-funnel-enabled"), []byte("enabled\n"), 0o644)
	if !f.tun.Status().Autostart {
		t.Fatal("legacy marker not honoured")
	}
	if _, err := os.Stat(filepath.Join(f.root, ".tunnel-enabled")); err != nil {
		t.Fatal("legacy marker not migrated")
	}
	if _, err := os.Stat(filepath.Join(f.root, ".tailscale-funnel-enabled")); err == nil {
		t.Fatal("legacy marker left behind")
	}
}

func TestMissingCloudflaredIsReportedAndAutostartStillApplied(t *testing.T) {
	f := newFixture(t)
	got := f.tun.Start("", true)
	if got.State != "error" || !strings.Contains(got.Error, "cloudflared") || !got.Autostart {
		t.Fatalf("%+v", got)
	}
	f.env["CLOUDFLARED_PATH"] = filepath.Join(f.root, "missing") // set but absent: no PATH fallback
	f.tun.LookPath = func(string) (string, error) { return "/bin/true", nil }
	if got := f.tun.Start("", true); got.State != "error" {
		t.Fatalf("%+v", got)
	}
}

func TestTokenWithWhitespaceIsRejectedAndNotSaved(t *testing.T) {
	f := newFixture(t)
	for _, tok := range []string{"abc def", "abc\ndef", "ab cd"} {
		if got := f.tun.Start(tok, true); got.State != "error" {
			t.Fatalf("%q: %+v", tok, got)
		}
	}
	if _, err := os.Stat(filepath.Join(f.root, "tunnel", "token")); err == nil {
		t.Fatal("token saved")
	}
	// A whitespace-only token behaves like no token.
	f.binary(fakeCloudflared)
	if got := f.tun.Start("   ", false); got.HasToken {
		t.Fatalf("%+v", got)
	}
	f.waitLog("--url http://127.0.0.1:8123")
}

func TestNamedTunnelRunsWithSavedTokenAndStops(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	f.env["PUBLIC_URL"] = "https://zvit.example.com"
	f.metrics["/ready"] = map[string]any{"readyConnections": 2}
	started := f.tun.Start("secret-token", true)
	if started.State != "running" || started.PublicURL != "https://zvit.example.com" || !started.HasToken || !started.Enabled {
		t.Fatalf("%+v", started)
	}
	if b, _ := json.Marshal(started); strings.Contains(string(b), "secret-token") {
		t.Fatal("token leaked")
	}
	tokenFile := filepath.Join(f.root, "tunnel", "token")
	if b, _ := os.ReadFile(tokenFile); string(b) != "secret-token" {
		t.Fatalf("token file %q", b)
	}
	if st, _ := os.Stat(tokenFile); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}
	f.waitLog("env-token: secret-token")
	if strings.Contains(f.logText(), "--token") {
		t.Fatal("the token must not be on the command line")
	}
	stopped := f.tun.Stop()
	if stopped.State != "stopped" || !stopped.Autostart || stopped.Enabled {
		t.Fatalf("%+v", stopped)
	}
}

func TestSavedTokenFileModeIsFixedWhenItAlreadyExists(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	os.MkdirAll(filepath.Join(f.root, "tunnel"), 0o755)
	os.WriteFile(filepath.Join(f.root, "tunnel", "token"), []byte("old"), 0o644)
	f.tun.Start("new-token", true)
	if st, _ := os.Stat(filepath.Join(f.root, "tunnel", "token")); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}
}

func TestEnvTokenOverridesSavedOne(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	f.env["TUNNEL_TOKEN"] = "from-env"
	f.tun.Start("saved", true)
	f.waitLog("env-token: from-env")
}

func TestQuickTunnelReportsTrycloudflareURL(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	f.metrics["/ready"] = map[string]any{"readyConnections": 1}
	f.metrics["/quicktunnel"] = map[string]any{"hostname": "calm-river.trycloudflare.com"}
	got := f.tun.Start("", false)
	if got.PublicURL != "https://calm-river.trycloudflare.com" || got.Autostart {
		t.Fatalf("%+v", got)
	}
	f.waitLog("--url http://127.0.0.1:8123")
}

func TestStartingUntilAConnectionIsReady(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	if got := f.tun.Start("", true); got.State != "starting" || got.PublicURL != "" {
		t.Fatalf("%+v", got)
	}
}

func TestCrashedProcessSurfacesItsErrorUntilNextStartOrStop(t *testing.T) {
	f := newFixture(t)
	f.binary(failingCloudflared)
	f.tun.Start("bad-token", true)
	var got TunnelStatus
	for i := 0; i < 100; i++ {
		if got = f.tun.Status(); got.State == "error" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got.State != "error" || !strings.Contains(got.Error, "token is not valid") || got.Enabled {
		t.Fatalf("%+v", got)
	}
	if again := f.tun.Status(); again.State != "error" {
		t.Fatalf("error must persist: %+v", again)
	}
	if got := f.tun.Stop(); got.State != "stopped" {
		t.Fatalf("%+v", got)
	}
}

func TestExitWithoutLogGivesTheExitCode(t *testing.T) {
	f := newFixture(t)
	f.binary("#!/bin/sh\nexit 3\n")
	f.tun.Start("", true)
	for i := 0; i < 100; i++ {
		if got := f.tun.Status(); got.State == "error" {
			if !strings.Contains(got.Error, "3") {
				t.Fatalf("%+v", got)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("never reported the exit")
}

func TestLastLogLineKeeps300Runes(t *testing.T) {
	f := newFixture(t)
	os.MkdirAll(filepath.Join(f.root, "tunnel"), 0o755)
	long := "ERR " + strings.Repeat("я", 500)
	os.WriteFile(filepath.Join(f.root, "tunnel", "cloudflared.log"), []byte("info one\n"+long+"\ninfo two\n"), 0o644)
	got := f.tun.lastLogLine()
	if r := []rune(got); len(r) != 300 || r[299] != 'я' {
		t.Fatalf("%d runes", len(r))
	}
}

func TestStartIfEnabledRules(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	f.env["TUNNEL_ENABLED"], f.env["TUNNEL_TOKEN"] = "0", "x"
	if f.tun.StartIfEnabled() != nil {
		t.Fatal("TUNNEL_ENABLED=0 must win")
	}
	delete(f.env, "TUNNEL_ENABLED")
	if f.tun.StartIfEnabled() == nil {
		t.Fatal("TUNNEL_TOKEN starts it")
	}
	f.tun.Stop()
	f.env["TUNNEL_TOKEN"] = ""
	f.tun.SetAutostart(true)
	if f.tun.StartIfEnabled() == nil {
		t.Fatal("the saved preference starts it")
	}
}

func TestRestartWithNewTokenReplacesTheProcess(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	f.tun.Start("one", true)
	f.waitLog("env-token: one")
	f.tun.Start("two", true)
	f.waitLog("env-token: two")
	if strings.Contains(f.logText(), "env-token: one") {
		t.Fatal("log must be truncated on restart")
	}
}

func TestConcurrentStatusStartStop(t *testing.T) {
	f := newFixture(t)
	f.binary(fakeCloudflared)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				switch (i + j) % 3 {
				case 0:
					f.tun.Start("", true)
				case 1:
					f.tun.Stop()
				default:
					f.tun.Status()
				}
			}
		}(i)
	}
	wg.Wait()
}

func TestBundledDefaultEnablesOnceAndRespectsLaterChoice(t *testing.T) {
	f := newFixture(t)
	f.tun.EnableByDefault = true
	f.tun.StartIfEnabled() // fails to find a binary, but records the default
	if !f.tun.Status().Autostart {
		t.Fatal("first start of a bundled build must turn autostart on")
	}
	f.tun.SetAutostart(false) // the admin switches it off
	f.tun.StartIfEnabled()
	if f.tun.Status().Autostart {
		t.Fatal("the default must not override a later choice")
	}
}

func TestBundledDefaultHonoursTunnelEnabledOff(t *testing.T) {
	f := newFixture(t)
	f.tun.EnableByDefault = true
	f.env["TUNNEL_ENABLED"] = "0"
	if f.tun.StartIfEnabled() != nil || f.tun.Status().Autostart {
		t.Fatal("TUNNEL_ENABLED=0 must keep the tunnel off")
	}
}

func TestNoDefaultWithoutBundle(t *testing.T) {
	f := newFixture(t)
	if f.tun.StartIfEnabled() != nil || f.tun.Status().Autostart {
		t.Fatal("non-bundled builds keep the tunnel off until enabled")
	}
}

func TestBundledBinaryComesBeforePath(t *testing.T) {
	f := newFixture(t)
	f.tun.LookPath = func(string) (string, error) { return "/from/path", nil }
	f.tun.Bundled = func(dir string) (string, error) { return filepath.Join(dir, "bundled"), nil }
	if got := f.tun.binary(); got != filepath.Join(f.root, "tunnel", "bundled") {
		t.Fatalf("got %q", got)
	}
	f.env["CLOUDFLARED_PATH"] = filepath.Join(f.root, "missing") // an explicit setting still wins, with no fallback
	if got := f.tun.binary(); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestTermuxPrefersPathThenBundled(t *testing.T) {
	f := newFixture(t)
	f.env["TERMUX_VERSION"] = "0.118"
	f.tun.Bundled = func(dir string) (string, error) { return filepath.Join(dir, "bundled"), nil }
	f.tun.LookPath = func(string) (string, error) { return "/data/data/com.termux/files/usr/bin/cloudflared", nil }
	if got := f.tun.binary(); got != "/data/data/com.termux/files/usr/bin/cloudflared" {
		t.Fatalf("Termux must prefer its own package, got %q", got)
	}
	f.tun.LookPath = func(string) (string, error) { return "", os.ErrNotExist }
	if got := f.tun.binary(); got != filepath.Join(f.root, "tunnel", "bundled") {
		t.Fatalf("falls back to the bundled copy, got %q", got)
	}
}

func TestMissingCloudflaredMessageSaysWhatToDo(t *testing.T) {
	f := newFixture(t)
	if got := f.tun.Start("", false); !strings.Contains(got.Error, "scripts/build.sh") {
		t.Fatalf("generic message: %q", got.Error)
	}
	f.env["TERMUX_VERSION"] = "0.118"
	if got := f.tun.Start("", false); !strings.Contains(got.Error, "pkg install cloudflared") {
		t.Fatalf("Termux message: %q", got.Error)
	}
}
