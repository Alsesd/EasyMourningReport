package system

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestLogger(r *LogRing) *log.Logger { return log.New(r, "", log.LstdFlags) }

func TestLogRingKeepsWarningsAndErrorsAndPassesEverythingOn(t *testing.T) {
	var out bytes.Buffer
	r := NewLogRing(&out, 3)
	l := newTestLogger(r)
	l.Printf("server started")              // info: not kept
	l.Printf("backup failed: disk full")    // error
	l.Printf("WARNING: not writable")       // warning
	l.Printf("push to a browser failed: x") // error
	l.Printf("another failed: y")           // error: pushes the oldest out (capacity 3)
	if !strings.Contains(out.String(), "server started") {
		t.Fatal("every line must still reach the original output")
	}
	got := r.Recent("", 10)
	if len(got) != 3 || got[0].Message != "another failed: y" || got[2].Message != "WARNING: not writable" {
		t.Fatalf("newest first, capacity 3: %+v", got)
	}
	if got[0].Level != "error" || got[2].Level != "warning" || strings.HasPrefix(got[0].Message, "20") {
		t.Fatalf("level and the stripped time stamp: %+v", got)
	}
	if e := r.Recent("warning", 10); len(e) != 1 {
		t.Fatalf("filter: %+v", e)
	}
}

func TestLogRingMergesRepeatsSoOneFaultCannotEvictTheRest(t *testing.T) {
	r := NewLogRing(nil, 5)
	l := newTestLogger(r)
	l.Printf("disk check failed")
	for i := 0; i < 50; i++ {
		l.Printf("push to one browser failed: timeout")
	}
	got := r.Recent("", 10)
	if len(got) != 2 || got[0].Count != 50 || got[1].Message != "disk check failed" {
		t.Fatalf("%+v", got)
	}
	if errs, _ := r.Counts(time.Now().Add(-time.Hour)); errs != 51 {
		t.Fatalf("counts include repeats: %d", errs)
	}
	if errs, _ := r.Counts(time.Now().Add(time.Hour)); errs != 0 {
		t.Fatalf("counts respect the time: %d", errs)
	}
}

func TestLogRingRedactsUrlsAndTrimsLongLines(t *testing.T) {
	r := NewLogRing(nil, 5)
	l := newTestLogger(r)
	l.Printf(`push failed: Post "https://fcm.googleapis.com/fcm/send/SECRET-TOKEN-123?x=1": timeout`)
	l.Print("failed " + strings.Repeat("я", 2000))
	got := r.Recent("", 10)
	if strings.Contains(got[1].Message, "SECRET") || !strings.Contains(got[1].Message, "https://fcm.googleapis.com/…") {
		t.Fatalf("the endpoint must be reduced to its host: %q", got[1].Message)
	}
	if n := len([]rune(got[0].Message)); n > maxMessage {
		t.Fatalf("trimmed: %d", n)
	}
}

func TestLogRingSurvivesARestartAndRotates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "legkyi.log")
	r := NewLogRing(nil, 50)
	if err := r.AttachFile(path, 600); err != nil {
		t.Fatal(err)
	}
	l := newTestLogger(r)
	for i := 0; i < 12; i++ {
		l.Printf("job %d failed: reason", i) // distinct lines: no merging
	}
	_ = r.Close()
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("the file was rotated once it was full: %v", err)
	}
	if fi, _ := os.Stat(path); fi.Mode().Perm() != 0o600 {
		t.Fatalf("private file: %v", fi.Mode())
	}
	again := NewLogRing(nil, 50)
	if err := again.AttachFile(path, 600); err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	got := again.Recent("", 50)
	if len(got) == 0 || got[0].Message != fmt.Sprintf("job %d failed: reason", 11) {
		t.Fatalf("the newest entry is back after a restart: %+v", got)
	}
	for i := 1; i < len(got); i++ {
		if !got[i].At.Before(got[i-1].At) && !got[i].At.Equal(got[i-1].At) {
			t.Fatalf("order: %+v", got)
		}
	}
}
