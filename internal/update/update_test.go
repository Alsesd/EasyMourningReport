package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var built = time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)

type fakeGitHub struct {
	srv      *httptest.Server
	tag      string
	commit   string
	pub      time.Time
	binary   []byte
	sumsLine string // overrides the checksum line when set
	omit     string // asset name to leave out
	hits     int
	base     string // address the asset links point at (default: this server)
}

func newFake(t *testing.T, binary string) *fakeGitHub {
	f := &fakeGitHub{tag: "auto-9", commit: "bbb", pub: built.Add(time.Hour), binary: []byte(binary)}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits++
		if r.Header.Get("User-Agent") != "legkyi-updater" {
			t.Errorf("unexpected user agent %q", r.Header.Get("User-Agent"))
		}
		switch r.URL.Path {
		case "/repos/alsesd/easymourningreport/releases/latest":
			var assets []map[string]any
			for _, n := range []string{"legkyi", "legkyi.exe", "legkyi-linux-arm64", "SHA256SUMS.txt"} {
				if n != f.omit {
					assets = append(assets, map[string]any{"name": n, "browser_download_url": f.base + "/dl/" + n, "size": len(f.binary)})
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"tag_name": f.tag, "target_commitish": f.commit, "published_at": f.pub, "assets": assets})
		case "/dl/SHA256SUMS.txt":
			sum := sha256.Sum256(f.binary)
			line := hex.EncodeToString(sum[:]) + "  legkyi"
			if f.sumsLine != "" {
				line = f.sumsLine
			}
			fmt.Fprintln(w, "0000000000000000000000000000000000000000000000000000000000000000  legkyi.exe")
			fmt.Fprintln(w, line)
		case "/dl/legkyi":
			w.Write(f.binary)
		default:
			http.NotFound(w, r)
		}
	}))
	f.base = f.srv.URL
	t.Cleanup(f.srv.Close)
	return f
}

func newUpdater(t *testing.T, f *fakeGitHub) (*Updater, string) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "legkyi")
	os.WriteFile(exe, []byte("old program"), 0o755)
	return &Updater{API: f.srv.URL, AllowHTTP: true, Exe: exe, GOOS: "linux", GOARCH: "amd64",
		Build: Build{Tag: "auto-8", Commit: "aaa", BuiltAt: built}}, exe
}

func TestNewerRelease(t *testing.T) {
	f := newFake(t, "new program")
	u, _ := newUpdater(t, f)
	st := u.Check(context.Background())
	if !st.Available || st.Latest != "auto-9" || st.State != "idle" || st.LastChecked == nil || !st.Enabled {
		t.Fatalf("%+v", st)
	}
}

func TestNothingToDo(t *testing.T) {
	for name, mut := range map[string]func(*fakeGitHub){
		"same tag":      func(f *fakeGitHub) { f.tag = "auto-8" },
		"same commit":   func(f *fakeGitHub) { f.commit = "aaa" },
		"older release": func(f *fakeGitHub) { f.pub = built.Add(-time.Hour) },
	} {
		f := newFake(t, "x")
		mut(f)
		u, _ := newUpdater(t, f)
		if st := u.Check(context.Background()); st.Available {
			t.Fatalf("%s must not update: %+v", name, st)
		}
		if err := u.Apply(context.Background()); err == nil {
			t.Fatalf("%s: Apply must refuse", name)
		}
	}
}

func TestApplyReplacesTheProgramAfterBackupAndAsksForRestart(t *testing.T) {
	f := newFake(t, "new program")
	u, exe := newUpdater(t, f)
	var steps []string
	u.Backup = func() error { steps = append(steps, "backup"); return nil }
	u.Restart = func() { steps = append(steps, "restart") }
	u.Check(context.Background())
	if err := u.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "new program" {
		t.Fatalf("program not replaced: %q", got)
	}
	if st, _ := os.Stat(exe); st.Mode()&0o111 == 0 {
		t.Fatal("the new program must be executable")
	}
	if strings.Join(steps, ",") != "backup,restart" {
		t.Fatalf("order: %v", steps)
	}
	entries, _ := os.ReadDir(filepath.Dir(exe))
	if len(entries) != 2 { // the program and its predecessor, no temporary files
		t.Fatalf("unexpected files: %v", entries)
	}
	if old, _ := os.ReadFile(exe + ".old"); string(old) != "old program" {
		t.Fatalf("the previous program must stay available for a rollback: %q", old)
	}
	if u.Status().State != "restarting" {
		t.Fatalf("%+v", u.Status())
	}
}

func TestBadDownloadsLeaveTheProgramAlone(t *testing.T) {
	cases := map[string]func(*fakeGitHub){
		"checksum mismatch": func(f *fakeGitHub) { f.sumsLine = strings.Repeat("1", 64) + "  legkyi" },
		"no sums for asset": func(f *fakeGitHub) { f.sumsLine = strings.Repeat("1", 64) + "  other" },
		"asset missing":     func(f *fakeGitHub) { f.omit = "legkyi" },
		"checksums missing": func(f *fakeGitHub) { f.omit = "SHA256SUMS.txt" },
	}
	for name, mut := range cases {
		f := newFake(t, "evil")
		mut(f)
		u, exe := newUpdater(t, f)
		restarted := false
		u.Restart = func() { restarted = true }
		u.Check(context.Background())
		if err := u.Apply(context.Background()); err == nil {
			t.Fatalf("%s: must fail", name)
		}
		if got, _ := os.ReadFile(exe); string(got) != "old program" || restarted {
			t.Fatalf("%s: program touched (%q) or restarted", name, got)
		}
		if st := u.Status(); st.State != "error" || st.Error == "" {
			t.Fatalf("%s: error must be reported: %+v", name, st)
		}
	}
}

func TestFailedBackupStopsTheUpdate(t *testing.T) {
	f := newFake(t, "new program")
	u, exe := newUpdater(t, f)
	u.Backup = func() error { return fmt.Errorf("disk full") }
	u.Check(context.Background())
	if err := u.Apply(context.Background()); err == nil {
		t.Fatal("must fail")
	}
	if got, _ := os.ReadFile(exe); string(got) != "old program" {
		t.Fatal("program replaced without a backup")
	}
}

func TestDevelopmentBuildsNeverUpdate(t *testing.T) {
	f := newFake(t, "x")
	u, _ := newUpdater(t, f)
	u.Build = Build{}
	if u.Enabled() || u.Status().Enabled {
		t.Fatal("an unstamped build must not update")
	}
	if err := u.Apply(context.Background()); err == nil {
		t.Fatal("Apply must refuse")
	}
	u.Loop(context.Background(), 0, 0) // returns at once
	if f.hits != 0 {
		t.Fatal("no network for a development build")
	}
}

func TestRefusesPlainHTTPAndUnknownPlatforms(t *testing.T) {
	f := newFake(t, "x")
	u, _ := newUpdater(t, f)
	u.AllowHTTP = false
	if st := u.Check(context.Background()); st.State != "error" || !strings.Contains(st.Error, "https") {
		t.Fatalf("%+v", st)
	}
	u.GOOS = "darwin"
	if u.Enabled() {
		t.Fatal("no release file for macOS")
	}
}

func TestSwapWindowsKeepsTheOldFileAndRollsBack(t *testing.T) {
	dir := t.TempDir()
	exe, fresh := filepath.Join(dir, "legkyi.exe"), filepath.Join(dir, "new")
	os.WriteFile(exe, []byte("v1"), 0o755)
	os.WriteFile(fresh, []byte("v2"), 0o755)
	if err := Swap(exe, fresh, "windows"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "v2" {
		t.Fatal("not replaced")
	}
	if b, _ := os.ReadFile(exe + ".old"); string(b) != "v1" {
		t.Fatal("the previous program must be kept as .old")
	}
	// A failing second rename puts the running program back.
	if err := Swap(exe, filepath.Join(dir, "missing"), "windows"); err == nil {
		t.Fatal("must fail")
	}
	if b, _ := os.ReadFile(exe); string(b) != "v2" {
		t.Fatalf("rollback failed: %q", b)
	}
}

func TestChecksumLineFormats(t *testing.T) {
	h := strings.Repeat("A", 64)
	if got := checksumFor(h+" *legkyi\n", "legkyi"); got != strings.ToLower(h) {
		t.Fatal(got)
	}
	if checksumFor("short  legkyi", "legkyi") != "" {
		t.Fatal("a malformed hash must not match")
	}
}

func TestStartRunsInTheBackgroundAndRefusesASecondInstall(t *testing.T) {
	f := newFake(t, "new program")
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/dl/legkyi" {
			<-release // the download hangs until the test lets go
		}
		f.srv.Config.Handler.ServeHTTP(w, r)
	}))
	defer slow.Close()
	f.base = slow.URL
	u, exe := newUpdater(t, f)
	u.API = slow.URL
	restarted := make(chan struct{}, 1)
	u.Restart = func() { restarted <- struct{}{} }
	u.Check(context.Background())

	if err := u.Start(); err != nil {
		t.Fatal(err)
	}
	if st := u.Status(); st.State != "downloading" {
		t.Fatalf("Start must return while the download runs: %+v", st)
	}
	if err := u.Start(); err == nil {
		t.Fatal("a second install during a download must be refused")
	}
	if err := u.Apply(context.Background()); err == nil {
		t.Fatal("Apply during a download must be refused")
	}
	if st := u.Check(context.Background()); st.State != "downloading" {
		t.Fatalf("a check must not disturb the install: %+v", st)
	}
	close(release)
	select {
	case <-restarted:
	case <-time.After(5 * time.Second):
		t.Fatal("restart was never requested")
	}
	if got, _ := os.ReadFile(exe); string(got) != "new program" {
		t.Fatalf("program: %q", got)
	}
}
