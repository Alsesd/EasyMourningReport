package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// SnapshotTag marks the copies taken for a download. They are kept outside Keep, with their own small cap.
const SnapshotTag = "snapshot"

// SnapshotKeep is how many download snapshots stay on the server: the file is only needed while it is sent.
const SnapshotKeep = 10

// volatileTables change on almost every request (sessions, device tokens, passkey counters, notification
// read marks and reminder bookkeeping). A change in them alone is not a reason for a new copy.
var volatileTables = map[string]bool{
	"user_sessions": true, "session_devices": true, "passkeys": true,
	"notifications": true, "notification_reminders": true,
}

// Backups makes a consistent copy, verified. Retention counts regular copies (Keep) and snapshots (SnapshotKeep)
// separately, newest first by the time in the name.
type Backups struct {
	Store *Store
	Dir   string
	Keep  int
	Now   func() time.Time // injectable clock; names are written in UTC

	mu      sync.Mutex // Run is called by the loop, shutdown and request handlers
	lastSum string     // content fingerprint at the last copy (empty until the first one in this run)
}

func (b *Backups) now() time.Time {
	if b.Now != nil {
		return b.Now()
	}
	return time.Now()
}

// nameTime reads the moment a copy was made from its name. A name ending in Z (all new ones) is UTC; older
// names carry the local time of the machine that wrote them.
func nameTime(path string) time.Time {
	n := strings.TrimSuffix(filepath.Base(path), ".db")
	n = strings.TrimPrefix(n, "reports-")
	if len(n) < 15 {
		return time.Time{}
	}
	loc := time.Local
	if len(n) > 15 && n[15] == 'Z' {
		loc = time.UTC
	}
	t, err := time.ParseInLocation("20060102-150405", n[:15], loc)
	if err != nil {
		return time.Time{}
	}
	return t
}

// IsSnapshot reports whether a copy file was taken for a download.
func IsSnapshot(path string) bool {
	return strings.HasSuffix(filepath.Base(path), "-"+SnapshotTag+".db")
}

// List returns backup files, newest first.
func (b *Backups) List() []string {
	m, _ := filepath.Glob(filepath.Join(b.Dir, "reports-*.db"))
	sort.Slice(m, func(i, j int) bool {
		ti, tj := nameTime(m[i]), nameTime(m[j])
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return m[i] > m[j]
	})
	return m
}

// fingerprint hashes the content of every table except the volatile ones.
func (b *Backups) fingerprint() (string, error) {
	rows, err := b.Store.R.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		return "", err
	}
	var tables []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return "", err
		}
		if !volatileTables[n] {
			tables = append(tables, n)
		}
	}
	rows.Close()
	h := sha256.New()
	for _, t := range tables {
		fmt.Fprintf(h, "\x00%s\x00", t)
		data, err := b.Store.R.Query(`SELECT * FROM "` + strings.ReplaceAll(t, `"`, `""`) + `" ORDER BY rowid`)
		if err != nil {
			data, err = b.Store.R.Query(`SELECT * FROM "` + strings.ReplaceAll(t, `"`, `""`) + `"`)
			if err != nil {
				return "", err
			}
		}
		cols, _ := data.Columns()
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		for data.Next() {
			if err := data.Scan(ptrs...); err != nil {
				data.Close()
				return "", err
			}
			fmt.Fprintf(h, "%v\x01", vals)
		}
		if err := data.Err(); err != nil {
			data.Close()
			return "", err
		}
		data.Close()
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// lastChange is the newest mtime of the database and its WAL file.
func (b *Backups) lastChange() time.Time {
	var t time.Time
	for _, p := range []string{b.Store.Path, b.Store.Path + "-wal"} {
		if fi, err := os.Stat(p); err == nil && fi.ModTime().After(t) {
			t = fi.ModTime()
		}
	}
	return t
}

// Run takes a backup. Without a tag it is skipped (returns "") when the data did not change since the last
// copy: sessions, device tokens, passkey counters and notification marks do not count as a change. Right after
// the program starts there is no fingerprint yet, so the file times decide. A copy failing quick_check is
// deleted and an error returned.
func (b *Backups) Run(tag string) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, err := os.Stat(b.Store.Path); err != nil {
		return "", nil
	}
	if err := os.MkdirAll(b.Dir, 0o755); err != nil {
		return "", err
	}
	existing := b.List()
	sum, sumErr := b.fingerprint()
	if tag == "" && len(existing) > 0 {
		if b.lastSum != "" && sumErr == nil {
			if sum == b.lastSum {
				return "", nil
			}
		} else if fi, err := os.Stat(existing[0]); err == nil && !b.lastChange().After(fi.ModTime()) {
			return "", nil
		}
	}
	// VACUUM INTO refuses an existing target (Python silently overwrote on a same-second
	// collision). Advance the timestamp until the name is free, so time order stays strict.
	var dest string
	for t := b.now().UTC(); ; t = t.Add(time.Second) {
		name := "reports-" + t.Format("20060102-150405") + "Z"
		if tag != "" {
			name += "-" + tag
		}
		dest = filepath.Join(b.Dir, name+".db")
		if !fileExists(dest) {
			break
		}
	}
	tmp := dest + ".tmp"
	_ = os.Remove(tmp)
	if _, err := b.Store.R.Exec("VACUUM INTO ?", tmp); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("backup: %w", err)
	}
	verdict, err := verifyCopy(tmp)
	if err != nil || verdict != "ok" {
		_ = os.Remove(tmp)
		if err != nil {
			return "", fmt.Errorf("backup verification: %w", err)
		}
		return "", fmt.Errorf("backup failed its integrity check: %s", verdict)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	if sumErr == nil {
		b.lastSum = sum
	}
	keep := b.Keep
	if keep < 1 {
		keep = 1
	}
	var regular, snaps []string
	for _, f := range b.List() {
		if IsSnapshot(f) {
			snaps = append(snaps, f)
		} else {
			regular = append(regular, f)
		}
	}
	for _, group := range []struct {
		files []string
		keep  int
	}{{regular, keep}, {snaps, SnapshotKeep}} {
		if len(group.files) > group.keep {
			for _, old := range group.files[group.keep:] {
				_ = os.Remove(old)
			}
		}
	}
	return dest, nil
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return !errors.Is(err, os.ErrNotExist)
}

// verifyCopy makes the copy a self-contained single file (rollback journal) and checks it.
func verifyCopy(path string) (string, error) {
	db, err := sql.Open("sqlite", fileURI(path))
	if err != nil {
		return "", err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var mode string
	if err := db.QueryRow("PRAGMA journal_mode=DELETE").Scan(&mode); err != nil {
		return "", err
	}
	var verdict string
	if err := db.QueryRow("PRAGMA quick_check").Scan(&verdict); err != nil {
		return "", err
	}
	return strings.TrimSpace(verdict), nil
}
