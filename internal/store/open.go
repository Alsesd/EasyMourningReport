// Package store is the only code that opens, checks, backs up and closes the SQLite database.
package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// Store holds two pools over one file: W has a single connection and opens every
// transaction with BEGIN IMMEDIATE (no read-then-write SQLITE_BUSY races); R serves reads.
type Store struct {
	W, R        *sql.DB
	Path        string
	JournalMode string
}

func fileURL(path string) url.URL {
	p := filepath.ToSlash(path)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // Windows drive paths: file:///C:/dir/reports.db
	}
	return url.URL{Scheme: "file", Path: p}
}

func fileURI(path string) string { u := fileURL(path); return u.String() }

// dsn builds a modernc DSN; every pooled connection gets the same pragmas as Python's
// "connect" listener (foreign_keys, journal_mode, synchronous=FULL) plus a 30 s busy wait.
func dsn(path, journalMode, txlock string) string {
	u := fileURL(path)
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(30000)")
	q.Add("_pragma", "synchronous(FULL)")
	q.Add("_pragma", "journal_mode("+journalMode+")")
	if txlock != "" {
		q.Set("_txlock", txlock)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// Open opens the database file (creating an empty one if absent). It does not touch the schema.
func Open(path, journalMode string) (*Store, error) {
	if journalMode != "wal" && journalMode != "delete" {
		return nil, fmt.Errorf("invalid journal mode %q", journalMode)
	}
	w, err := sql.Open("sqlite", dsn(path, journalMode, "immediate"))
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	r, err := sql.Open("sqlite", dsn(path, journalMode, ""))
	if err != nil {
		w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(8)
	s := &Store{W: w, R: r, Path: path, JournalMode: journalMode}
	if err := w.Ping(); err != nil {
		s.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	return s, nil
}

// Close closes both pools.
func (s *Store) Close() error {
	e1 := s.R.Close()
	e2 := s.W.Close()
	if e1 != nil {
		return e1
	}
	return e2
}

// Checkpoint folds the WAL into the database file (no-op outside WAL mode).
func (s *Store) Checkpoint() error {
	if s.JournalMode != "wal" {
		return nil
	}
	_, err := s.W.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}

// IntegrityCheck runs PRAGMA quick_check on the live database: "ok" or the first problem.
func (s *Store) IntegrityCheck() (string, error) {
	var verdict string
	err := s.R.QueryRow("PRAGMA quick_check").Scan(&verdict)
	return verdict, err
}

// Ping proves the database answers (used by /healthz).
func (s *Store) Ping() error {
	var one int
	return s.R.QueryRow("SELECT 1").Scan(&one)
}
