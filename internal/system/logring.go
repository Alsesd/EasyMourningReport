package system

import (
	"bufio"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// LogEntry is one warning or error of the program's own log. Consecutive identical lines are merged: Count says
// how many times it happened and At is the last time.
type LogEntry struct {
	At      time.Time `json:"at"`
	Level   string    `json:"level"` // "error" or "warning"
	Message string    `json:"message"`
	Count   int       `json:"count"`
}

// LogRing is the writer behind the standard logger. It passes every line on to the original output and keeps the
// warnings and errors, so the health page can say what went wrong, not only how often. With AttachFile the entries
// also survive a restart (a crash or a self-update would otherwise wipe exactly what is wanted afterwards).
// It never calls the log package itself: that would recurse into Write.
type LogRing struct {
	out io.Writer
	cap int

	mu      sync.Mutex
	entries []LogEntry // oldest first
	file    *os.File
	path    string
	max     int64
	size    int64
	lastOut time.Time // when the newest entry was last written to the file (repeats are written once a minute)
}

// NewLogRing keeps at most capacity entries and copies every line to out (nil: nowhere).
func NewLogRing(out io.Writer, capacity int) *LogRing {
	if capacity < 1 {
		capacity = 1
	}
	return &LogRing{out: out, cap: capacity}
}

var (
	stampRE = regexp.MustCompile(`^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}(\.\d+)? `)
	urlRE   = regexp.MustCompile(`https?://[^\s"')\]]+`)
)

const maxMessage = 600

// RedactURLs reduces every URL to scheme://host/…: a push endpoint or a signed link is a capability and must not
// be readable on a page (or in a file) just because an error message carried it.
func RedactURLs(s string) string {
	return urlRE.ReplaceAllStringFunc(s, func(m string) string {
		u, err := url.Parse(m)
		if err != nil || u.Host == "" {
			return "[url]"
		}
		return u.Scheme + "://" + u.Host + "/…"
	})
}

// classify decides by the words the program's own messages use. It is a heuristic by design (the standard log has
// no levels): "failed" and "error" make an error, "warning" a warning, everything else is not kept.
func classify(msg string) string {
	l := strings.ToLower(msg)
	for _, w := range []string{"panic", "fatal", "server error", "internal error", "failed", "error", "помилк"} {
		if strings.Contains(l, w) {
			return "error"
		}
	}
	for _, w := range []string{"warning", "warn", "will retry"} {
		if strings.Contains(l, w) {
			return "warning"
		}
	}
	return ""
}

func clean(line string) string {
	line = stampRE.ReplaceAllString(strings.TrimSpace(line), "")
	line = RedactURLs(line)
	if utf8.RuneCountInString(line) > maxMessage {
		line = string([]rune(line)[:maxMessage-1]) + "…"
	}
	return line
}

// Write is called once per log line by the standard logger.
func (r *LogRing) Write(p []byte) (int, error) {
	var err error
	if r.out != nil {
		_, err = r.out.Write(p)
	}
	msg := clean(string(p))
	if level := classify(msg); level != "" {
		r.add(LogEntry{At: time.Now(), Level: level, Message: msg, Count: 1})
	}
	return len(p), err
}

func (r *LogRing) add(e LogEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n := len(r.entries); n > 0 && r.entries[n-1].Level == e.Level && r.entries[n-1].Message == e.Message {
		r.entries[n-1].Count++
		r.entries[n-1].At = e.At
		// A repeating line reaches the file once a minute, so one noisy fault cannot fill it.
		if e.At.Sub(r.lastOut) < time.Minute {
			return
		}
		e = r.entries[n-1]
	} else {
		r.entries = append(r.entries, e)
		if len(r.entries) > r.cap {
			r.entries = append([]LogEntry(nil), r.entries[len(r.entries)-r.cap:]...)
		}
	}
	r.persist(e)
}

// persist appends one JSON line, rotating the file first when it is full. Errors are dropped silently.
func (r *LogRing) persist(e LogEntry) {
	if r.file == nil {
		return
	}
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	b = append(b, '\n')
	if r.size+int64(len(b)) > r.max {
		r.rotate()
		if r.file == nil {
			return
		}
	}
	if n, err := r.file.Write(b); err == nil {
		r.size += int64(n)
		r.lastOut = e.At
	}
}

// rotate keeps one previous file (.1). The file is closed before the rename: Windows refuses to rename an open file.
func (r *LogRing) rotate() {
	_ = r.file.Close()
	r.file = nil
	_ = os.Remove(r.path + ".1")
	_ = os.Rename(r.path, r.path+".1")
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	r.file, r.size = f, 0
}

// AttachFile loads the entries of an earlier run from path (and path.1) and appends new ones to it from now on.
// The file holds JSON lines, is private (0600) and is rotated at about maxBytes.
func (r *LogRing) AttachFile(path string, maxBytes int64) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	var loaded []LogEntry
	for _, p := range []string{path + ".1", path} {
		loaded = append(loaded, readEntries(p)...)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	fi, _ := f.Stat()
	r.mu.Lock()
	defer r.mu.Unlock()
	merged := append(loaded, r.entries...)
	if len(merged) > r.cap {
		merged = merged[len(merged)-r.cap:]
	}
	r.entries, r.file, r.path, r.max = merged, f, path, maxBytes
	if fi != nil {
		r.size = fi.Size()
	}
	return nil
}

func readEntries(path string) []LogEntry {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []LogEntry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		var e LogEntry
		if json.Unmarshal(sc.Bytes(), &e) != nil || e.Message == "" {
			continue
		}
		if e.Count < 1 {
			e.Count = 1
		}
		if n := len(out); n > 0 && out[n-1].Level == e.Level && out[n-1].Message == e.Message {
			out[n-1].Count = e.Count
			out[n-1].At = e.At
			continue
		}
		out = append(out, e)
	}
	return out
}

// Close releases the file.
func (r *LogRing) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file == nil {
		return nil
	}
	err := r.file.Close()
	r.file = nil
	return err
}

// Recent returns up to limit entries, newest first; level "" means both, otherwise "error" or "warning".
func (r *LogRing) Recent(level string, limit int) []LogEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []LogEntry{}
	for i := len(r.entries) - 1; i >= 0 && len(out) < limit; i-- {
		if level == "" || r.entries[i].Level == level {
			out = append(out, r.entries[i])
		}
	}
	return out
}

// Counts adds up the occurrences (repeats included) whose last time is not before since.
func (r *LogRing) Counts(since time.Time) (errors, warnings int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.entries {
		if e.At.Before(since) {
			continue
		}
		if e.Level == "error" {
			errors += e.Count
		} else {
			warnings += e.Count
		}
	}
	return
}

// Persisted reports whether the entries are mirrored to a file.
func (r *LogRing) Persisted() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.file != nil
}
