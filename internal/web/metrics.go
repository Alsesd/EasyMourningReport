package web

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"legkyi/internal/core"
	"legkyi/internal/platform"
	"legkyi/internal/store"
	"legkyi/internal/system"
	"legkyi/internal/update"
)

// processStart is the real start of this process (not a.now(): tests fake the clock).
var processStart = time.Now()

// integrityTTL: quick_check reads the whole database, so the health page shows a cached verdict.
const integrityTTL = 10 * time.Minute

// tableCountsTTL: the row counts of the main tables are refreshed at most this often.
const tableCountsTTL = time.Minute

// ---- background jobs --------------------------------------------------------------------------------------------

// jobBoard records when each background job last ran and how it ended. The jobs run from main (separate App values),
// so the record is shared at package level.
type jobBoard struct {
	mu   sync.Mutex
	jobs map[string]jobState
}

type jobState struct {
	LastRun time.Time
	LastErr string
	Runs    int64
	Fails   int64
}

var jobs = &jobBoard{jobs: map[string]jobState{}}

// done notes one run of a job (err nil = fine).
func (b *jobBoard) done(name string, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.jobs[name]
	s.LastRun = time.Now()
	s.Runs++
	s.LastErr = ""
	if err != nil {
		s.Fails++
		s.LastErr = err.Error()
	}
	b.jobs[name] = s
}

func (b *jobBoard) get(name string) (jobState, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s, ok := b.jobs[name]
	return s, ok
}

// ---- push counters -----------------------------------------------------------------------------------------------

// pushStats counts what the dispatcher did since the start: browsers reached, subscriptions found gone (and
// forgotten) and sends that failed, with the last failure's text. The failures are in the error log too.
type pushStats struct {
	mu         sync.Mutex
	sent, gone int64
	failed     int64
	lastFail   string
	lastFailAt time.Time
}

var pushCounts = &pushStats{}

func (p *pushStats) record(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	switch err {
	case nil:
		p.sent++
	case platform.ErrSubscriptionGone:
		p.gone++
	default:
		p.failed++
		p.lastFail, p.lastFailAt = system.RedactURLs(err.Error()), time.Now()
	}
}

// ---- HTTP counters ----------------------------------------------------------------------------------------------

type httpMetrics struct {
	ok, client, server atomic.Int64
	mu                 sync.Mutex
	last5xx            *lastError
}

type lastError struct {
	At      time.Time
	Method  string
	Path    string // without the query string
	Status  int
	Message string // the cause, as far as the handler reported it
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

type errNoteKey struct{}

// errNote carries the text of a 500 from done (which knows the error) to counted (which knows the status).
type errNote struct {
	mu   sync.Mutex
	text string
}

func (n *errNote) set(t string) {
	n.mu.Lock()
	n.text = t
	n.mu.Unlock()
}

func (n *errNote) get() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.text
}

const maxFaultText = 300

func (m *httpMetrics) record5xx(r *http.Request, code int, text string) {
	if rs := []rune(text); len(rs) > maxFaultText {
		text = string(rs[:maxFaultText-1]) + "…"
	}
	m.server.Add(1)
	m.mu.Lock()
	m.last5xx = &lastError{At: time.Now(), Method: r.Method, Path: r.URL.Path, Status: code, Message: redactForPage(text)}
	m.mu.Unlock()
}

// counted counts the API responses by class since the program started (2xx/3xx, 4xx, 5xx) and remembers the last
// 5xx with its cause. A panic in a handler is turned into a logged 500 instead of a dropped connection.
func (m *httpMetrics) counted(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		note := &errNote{}
		r = r.WithContext(context.WithValue(r.Context(), errNoteKey{}, note))
		rec := &statusRecorder{ResponseWriter: w}
		defer func() {
			p := recover()
			if p == nil {
				return
			}
			if p == http.ErrAbortHandler {
				panic(p)
			}
			log.Printf("server error: panic serving %s %s: %v\n%s", r.Method, r.URL.Path, p, shortStack())
			if rec.status == 0 { // nothing was sent yet: answer instead of dropping the connection
				writeJSON(rec, http.StatusInternalServerError, map[string]string{"detail": "Внутрішня помилка сервера."})
			}
			m.record5xx(r, http.StatusInternalServerError, fmt.Sprint("panic: ", p))
		}()
		next.ServeHTTP(rec, r)
		code := rec.status
		if code == 0 {
			code = http.StatusOK
		}
		switch {
		case code >= 500:
			m.record5xx(r, code, note.get())
		case code >= 400:
			m.client.Add(1)
		default:
			m.ok.Add(1)
		}
	})
}

// shortStack is the top of the goroutine stack, enough to find the place of a panic.
func shortStack() string {
	lines := strings.Split(strings.TrimSpace(string(debug.Stack())), "\n")
	if len(lines) > 16 {
		lines = lines[:16]
	}
	return strings.Join(lines, "\n")
}

// redactForPage keeps a URL in an error text from reaching the page whole.
func redactForPage(s string) string { return system.RedactURLs(s) }

// ---- cached database figures ------------------------------------------------------------------------------------

type integrityVerdict struct {
	Verdict   string
	CheckedAt time.Time
}

type dbCache struct {
	mu        sync.Mutex
	integrity *integrityVerdict
	counts    map[string]int
	countsAt  time.Time
}

// integrity returns the cached quick_check verdict, running it when there is none or it is older than the TTL
// (force = a fresh run on demand).
func (a *App) integrity(force bool) integrityVerdict {
	c := &a.cache
	c.mu.Lock()
	defer c.mu.Unlock()
	if !force && c.integrity != nil && time.Since(c.integrity.CheckedAt) < integrityTTL {
		return *c.integrity
	}
	v, err := a.Store.IntegrityCheck()
	if err != nil {
		v = err.Error()
	}
	c.integrity = &integrityVerdict{Verdict: v, CheckedAt: time.Now()}
	return *c.integrity
}

// countedTables is a fixed list: table names are never taken from input.
var countedTables = []string{"users", "organisations", "products", "reports", "report_items", "transport_orders", "notifications", "audit_log"}

func (a *App) tableCounts(ctx context.Context) map[string]int {
	c := &a.cache
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.counts != nil && time.Since(c.countsAt) < tableCountsTTL {
		return c.counts
	}
	out := map[string]int{}
	for _, t := range countedTables {
		var n int
		if err := a.Store.R.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t).Scan(&n); err == nil {
			out[t] = n
		}
	}
	c.counts, c.countsAt = out, time.Now()
	return out
}

// ---- the endpoint -----------------------------------------------------------------------------------------------

type metricsDTO struct {
	Build struct {
		Version   string `json:"version"` // release tag, "" for a development build
		Commit    string `json:"commit"`
		BuiltAt   string `json:"built_at"`
		Go        string `json:"go"`
		Platform  string `json:"platform"`
		StartedAt string `json:"started_at"`
		UptimeSec int64  `json:"uptime_sec"`
		// For a build without a release tag (go build in a git checkout): the revision the compiler recorded.
		VCSCommit   string `json:"vcs_commit"`
		VCSModified bool   `json:"vcs_modified"` // uncommitted changes were in the tree
		SQLite      string `json:"sqlite"`       // the engine version
		SQLiteDrv   string `json:"sqlite_driver"`
	} `json:"build"`
	Runtime struct {
		Goroutines int    `json:"goroutines"`
		HeapBytes  uint64 `json:"heap_bytes"`
		SysBytes   uint64 `json:"sys_bytes"`
		GCRuns     uint32 `json:"gc_runs"`
	} `json:"runtime"`
	DB struct {
		FileBytes     int64          `json:"file_bytes"`
		WalBytes      int64          `json:"wal_bytes"`
		PageSize      int64          `json:"page_size"`
		PageCount     int64          `json:"page_count"`
		FreelistCount int64          `json:"freelist_count"`
		Journal       string         `json:"journal_mode"`
		Tables        map[string]int `json:"tables"`
	} `json:"db"`
	Integrity struct {
		Verdict   string `json:"verdict"`
		OK        bool   `json:"ok"`
		CheckedAt string `json:"checked_at"`
	} `json:"integrity"`
	Disk struct {
		Known      bool   `json:"known"`
		FreeBytes  uint64 `json:"free_bytes"`
		TotalBytes uint64 `json:"total_bytes"`
	} `json:"disk"`
	Backups struct {
		Count       int     `json:"count"`
		EveryMin    int     `json:"every_min"`
		LastCopyAt  *string `json:"last_copy_at"` // newest file: informational, copies are skipped when nothing changed
		LastRunAt   *string `json:"last_run_at"`  // last time the backup job ran
		LastError   string  `json:"last_error"`
		RunOverdue  bool    `json:"run_overdue"` // no run for 2x the interval, or the last run failed
		Configured  bool    `json:"configured"`
		TotalBytes  int64   `json:"total_bytes"`
		Snapshots   int     `json:"snapshots"`
		NewestBytes int64   `json:"newest_bytes"`
	} `json:"backups"`
	Jobs []jobDTO `json:"jobs"`
	Push struct {
		Configured    bool    `json:"configured"`
		Subscriptions int     `json:"subscriptions"`
		Backlog       int     `json:"backlog"` // notifications waiting to be pushed (older ones are retired unsent)
		Sent          int64   `json:"sent"`    // browsers reached since the start
		Gone          int64   `json:"gone"`    // subscriptions the browser had cancelled (forgotten)
		Failed        int64   `json:"failed"`  // sends that failed
		LastFailure   string  `json:"last_failure"`
		LastFailureAt *string `json:"last_failure_at"`
	} `json:"push"`
	Sessions struct {
		Live  int `json:"live"`
		Users int `json:"users"`
	} `json:"sessions"`
	HTTP struct {
		OK        int64      `json:"ok"`
		Client    int64      `json:"client_errors"` // 4xx: refusals such as an expired sign-in or a missing page
		Server    int64      `json:"server_errors"` // 5xx: faults of the program
		Last5xx   *lastErrDT `json:"last_server_error"`
		SinceSec  int64      `json:"since_sec"`
		Requests  int64      `json:"requests"`
		ServerPct float64    `json:"server_error_pct"`
	} `json:"http"`
}

type lastErrDT struct {
	At      string `json:"at"`
	Method  string `json:"method"`
	Path    string `json:"path"`
	Status  int    `json:"status"`
	Message string `json:"message"`
}

type jobDTO struct {
	Name    string  `json:"name"` // scheduler, backups (see metrics), push
	Label   string  `json:"label"`
	LastRun *string `json:"last_run"`
	Error   string  `json:"error"`
	Runs    int64   `json:"runs"`
	Fails   int64   `json:"fails"`
	Stale   bool    `json:"stale"` // should have run by now and has not
}

func (a *App) metrics(w http.ResponseWriter, r *http.Request, _ *platform.Principal) error {
	ctx := r.Context()
	var m metricsDTO
	now := time.Now()

	b := update.Current()
	m.Build.Version, m.Build.Commit = b.Tag, b.Commit
	if len(m.Build.Commit) > 8 {
		m.Build.Commit = m.Build.Commit[:8]
	}
	if !b.BuiltAt.IsZero() {
		m.Build.BuiltAt = servedTimeOf(b.BuiltAt)
	}
	m.Build.Go, m.Build.Platform = runtime.Version(), runtime.GOOS+"/"+runtime.GOARCH
	m.Build.StartedAt, m.Build.UptimeSec = servedTimeOf(processStart), int64(now.Sub(processStart).Seconds())

	m.Build.VCSCommit, m.Build.VCSModified, m.Build.SQLiteDrv = buildVCS()
	_ = a.Store.R.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&m.Build.SQLite)

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	m.Runtime.Goroutines, m.Runtime.HeapBytes, m.Runtime.SysBytes, m.Runtime.GCRuns = runtime.NumGoroutine(), ms.HeapAlloc, ms.Sys, ms.NumGC

	m.DB.Journal = a.Store.JournalMode
	if fi, err := os.Stat(a.Store.Path); err == nil {
		m.DB.FileBytes = fi.Size()
	}
	if fi, err := os.Stat(a.Store.Path + "-wal"); err == nil {
		m.DB.WalBytes = fi.Size()
	}
	for pragma, dst := range map[string]*int64{"page_size": &m.DB.PageSize, "page_count": &m.DB.PageCount, "freelist_count": &m.DB.FreelistCount} {
		_ = a.Store.R.QueryRowContext(ctx, "PRAGMA "+pragma).Scan(dst)
	}
	m.DB.Tables = a.tableCounts(ctx)

	iv := a.integrity(false)
	m.Integrity.Verdict, m.Integrity.OK, m.Integrity.CheckedAt = iv.Verdict, iv.Verdict == "ok", servedTimeOf(iv.CheckedAt)

	if free, total, ok := system.FreeDisk(filepath.Dir(a.Store.Path)); ok {
		m.Disk.Known, m.Disk.FreeBytes, m.Disk.TotalBytes = true, free, total
	}

	m.Backups.EveryMin = a.BackupEveryMin
	if a.Backups != nil {
		m.Backups.Configured = true
		files := a.Backups.List()
		m.Backups.Count = len(files)
		for i, f := range files {
			if fi, err := os.Stat(f); err == nil {
				m.Backups.TotalBytes += fi.Size()
				if i == 0 {
					m.Backups.NewestBytes = fi.Size()
					s := servedTimeOf(fi.ModTime().UTC())
					m.Backups.LastCopyAt = &s
				}
			}
			if store.IsSnapshot(f) {
				m.Backups.Snapshots++
			}
		}
		at, errText := a.Backups.RunStatus()
		m.Backups.LastError = errText
		if !at.IsZero() {
			s := servedTimeOf(at.UTC())
			m.Backups.LastRunAt = &s
		}
		interval := time.Duration(a.BackupEveryMin) * time.Minute
		m.Backups.RunOverdue = errText != "" || (interval > 0 && !at.IsZero() && now.Sub(at) > 2*interval)
	}

	jobList := []struct{ name, label string }{{"scheduler", "Планувальник (нагадування, очищення)"}, {"push", "Push-сповіщення"}}
	for _, j := range jobList {
		d := jobDTO{Name: j.name, Label: j.label}
		if j.name == "push" && a.Push == nil {
			d.Label += " — не налаштовано"
			m.Jobs = append(m.Jobs, d)
			continue
		}
		if s, ok := jobs.get(j.name); ok {
			t := servedTimeOf(s.LastRun.UTC())
			d.LastRun, d.Error, d.Runs, d.Fails = &t, s.LastErr, s.Runs, s.Fails
			limit := 5 * time.Minute // scheduler ticks every minute, the dispatcher every 3 s
			d.Stale = now.Sub(s.LastRun) > limit
		}
		m.Jobs = append(m.Jobs, d)
	}

	m.Push.Configured = a.Push != nil
	pushCounts.mu.Lock()
	m.Push.Sent, m.Push.Gone, m.Push.Failed, m.Push.LastFailure = pushCounts.sent, pushCounts.gone, pushCounts.failed, pushCounts.lastFail
	if !pushCounts.lastFailAt.IsZero() {
		t := servedTimeOf(pushCounts.lastFailAt.UTC())
		m.Push.LastFailureAt = &t
	}
	pushCounts.mu.Unlock()
	nowUnix := a.now().Unix()
	_ = a.Store.R.QueryRowContext(ctx, "SELECT COUNT(*) FROM push_subscriptions").Scan(&m.Push.Subscriptions)
	_ = a.Store.R.QueryRowContext(ctx, "SELECT COUNT(*) FROM notifications WHERE pushed_at = 0 AND created_at > ?", a.now().Add(-pushFreshness).Unix()).Scan(&m.Push.Backlog)
	_ = a.Store.R.QueryRowContext(ctx, "SELECT COUNT(*), COUNT(DISTINCT user_id) FROM user_sessions WHERE expires_at > ?", nowUnix).Scan(&m.Sessions.Live, &m.Sessions.Users)

	m.HTTP.OK, m.HTTP.Client, m.HTTP.Server = a.http.ok.Load(), a.http.client.Load(), a.http.server.Load()
	m.HTTP.Requests = m.HTTP.OK + m.HTTP.Client + m.HTTP.Server
	if m.HTTP.Requests > 0 {
		m.HTTP.ServerPct = float64(m.HTTP.Server) * 100 / float64(m.HTTP.Requests)
	}
	m.HTTP.SinceSec = m.Build.UptimeSec
	a.http.mu.Lock()
	if e := a.http.last5xx; e != nil {
		m.HTTP.Last5xx = &lastErrDT{servedTimeOf(e.At.UTC()), e.Method, e.Path, e.Status, e.Message}
	}
	a.http.mu.Unlock()

	writeJSON(w, http.StatusOK, m)
	return nil
}

// recheckIntegrity runs quick_check now (the «Перевірити» button) and returns the metrics' integrity part.
func (a *App) recheckIntegrity(w http.ResponseWriter, r *http.Request, _ *platform.Principal) error {
	iv := a.integrity(true)
	writeJSON(w, http.StatusOK, map[string]any{"verdict": iv.Verdict, "ok": iv.Verdict == "ok", "checked_at": servedTimeOf(iv.CheckedAt)})
	return nil
}

type logEntryDTO struct {
	At      string `json:"at"`
	Level   string `json:"level"`
	Message string `json:"message"`
	Count   int    `json:"count"`
}

type logsDTO struct {
	Entries    []logEntryDTO `json:"entries"`
	Errors24h  int           `json:"errors_24h"`
	Warnings24 int           `json:"warnings_24h"`
	Persisted  bool          `json:"persisted"` // entries are kept in a file and survive a restart
}

// logs lists the recent warnings and errors of the program (level= error, warning or empty for both).
func (a *App) logs(w http.ResponseWriter, r *http.Request, _ *platform.Principal) error {
	pm := core.Query(r)
	level := pm.String("level")
	limit := pm.Int("limit", 100, 1, 300)
	if err := pm.Err(); err != nil {
		return err
	}
	if level != "" && level != "error" && level != "warning" {
		return HTTPError{Status: 400, Detail: "Рівень: error або warning."}
	}
	out := logsDTO{Entries: []logEntryDTO{}}
	if a.Logs != nil {
		for _, e := range a.Logs.Recent(level, int(limit)) {
			out.Entries = append(out.Entries, logEntryDTO{servedTimeOf(e.At.UTC()), e.Level, e.Message, e.Count})
		}
		out.Errors24h, out.Warnings24 = a.Logs.Counts(time.Now().Add(-24 * time.Hour))
		out.Persisted = a.Logs.Persisted()
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

// buildVCS reads what the Go toolchain stamped into the binary: the git revision (short), whether the tree was
// dirty, and the version of the SQLite driver module. All empty when the build carries no such information.
func buildVCS() (commit string, modified bool, driver string) {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return
	}
	for _, s := range bi.Settings {
		switch s.Key {
		case "vcs.revision":
			commit = s.Value
			if len(commit) > 8 {
				commit = commit[:8]
			}
		case "vcs.modified":
			modified = s.Value == "true"
		}
	}
	for _, d := range bi.Deps {
		if d.Path == "modernc.org/sqlite" {
			driver = d.Version
		}
	}
	return
}
