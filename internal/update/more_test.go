package update

import (
	"context"
	"testing"
	"time"
)

func TestCurrentReadsTheStamp(t *testing.T) {
	oldT, oldC, oldB := Tag, Commit, BuiltAt
	defer func() { Tag, Commit, BuiltAt = oldT, oldC, oldB }()
	Tag, Commit, BuiltAt = "auto-3", "abc", "2026-11-01T10:00:00Z"
	b := Current()
	if b.Tag != "auto-3" || b.Commit != "abc" || !b.BuiltAt.Equal(time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("%+v", b)
	}
	BuiltAt = "garbage"
	if !Current().BuiltAt.IsZero() {
		t.Fatal("a bad stamp reads as no time")
	}
}

func TestAssetNames(t *testing.T) {
	for k, want := range map[[2]string]string{{"windows", "amd64"}: "legkyi.exe", {"linux", "amd64"}: "legkyi", {"linux", "arm64"}: "legkyi-linux-arm64", {"darwin", "arm64"}: ""} {
		if got := AssetName(k[0], k[1]); got != want {
			t.Errorf("%v: %q", k, got)
		}
	}
}

func TestDefaultsComeFromTheRuntime(t *testing.T) {
	u := &Updater{Build: Build{Tag: "x"}, Exe: "/tmp/legkyi"}
	if u.goos() == "" || u.goarch() == "" || u.now().IsZero() || u.client() == nil {
		t.Fatal("defaults")
	}
	u.Now = func() time.Time { return time.Unix(5, 0) }
	if u.now().Unix() != 5 {
		t.Fatal("injected clock")
	}
	if _, err := u.get(context.Background(), "ftp://x", 10); err == nil {
		t.Fatal("only https")
	}
	if _, err := u.get(context.Background(), "http://%zz", 10); err == nil {
		t.Fatal("bad url")
	}
}

func TestLoopChecksAndAppliesWhenAuto(t *testing.T) {
	f := newFake(t, "new program")
	u, exe := newUpdater(t, f)
	u.Auto = true
	restarted := make(chan struct{}, 1)
	u.Restart = func() { restarted <- struct{}{} }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go u.Loop(ctx, 5*time.Millisecond, time.Hour)
	select {
	case <-restarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the loop must check and install")
	}
	_ = exe
	cancel()
}

func TestLoopStopsWithItsContext(t *testing.T) {
	f := newFake(t, "x")
	u, _ := newUpdater(t, f)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { u.Loop(ctx, time.Hour, time.Hour); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Loop must return when cancelled")
	}
}

func TestStatusReportsAnUnwritableFolder(t *testing.T) {
	u := &Updater{Build: Build{Tag: "x"}, Exe: "/nonexistent-dir/legkyi", GOOS: "linux", GOARCH: "amd64"}
	if st := u.Status(); st.Writable || !st.Enabled {
		t.Fatalf("%+v", st)
	}
	if (&Updater{}).writable() {
		t.Fatal("no program path: not writable")
	}
}

func TestCheckToleratesAConcurrentCheck(t *testing.T) {
	f := newFake(t, "x")
	u, _ := newUpdater(t, f)
	u.busy = true
	if st := u.Check(context.Background()); st.State == "" {
		t.Fatal("a busy updater still reports")
	}
}
