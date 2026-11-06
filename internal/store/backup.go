package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Backups ports backend/app/db/backup.py: consistent copy, verified, retention by name.
type Backups struct {
	Store *Store
	Dir   string
	Keep  int
	Now   func() time.Time // injectable clock (local time, as in Python)
}

func (b *Backups) now() time.Time {
	if b.Now != nil {
		return b.Now()
	}
	return time.Now()
}

// List returns backup files, newest name first.
func (b *Backups) List() []string {
	m, _ := filepath.Glob(filepath.Join(b.Dir, "reports-*.db"))
	sort.Sort(sort.Reverse(sort.StringSlice(m)))
	return m
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

// Run takes a backup. Without a tag it is skipped (returns "") when nothing changed since the
// newest backup. A copy failing quick_check is deleted and an error returned.
func (b *Backups) Run(tag string) (string, error) {
	if _, err := os.Stat(b.Store.Path); err != nil {
		return "", nil
	}
	if err := os.MkdirAll(b.Dir, 0o755); err != nil {
		return "", err
	}
	existing := b.List()
	if tag == "" && len(existing) > 0 {
		if fi, err := os.Stat(existing[0]); err == nil && !b.lastChange().After(fi.ModTime()) {
			return "", nil
		}
	}
	// VACUUM INTO refuses an existing target (Python silently overwrote on a same-second
	// collision). Advance the timestamp until the name is free: the name format stays
	// Python's and name order stays equal to time order, which retention relies on.
	var dest string
	for t := b.now(); ; t = t.Add(time.Second) {
		name := "reports-" + t.Format("20060102-150405")
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
	keep := b.Keep
	if keep < 1 {
		keep = 1
	}
	if all := b.List(); len(all) > keep {
		for _, old := range all[keep:] {
			_ = os.Remove(old)
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
