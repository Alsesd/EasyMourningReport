package system

import (
	"os"
	"time"

	"legkyi/internal/store"
)

// Health is what the administration overview shows about the database and its backups.
type Health struct {
	DatabaseOK     bool
	Integrity      string
	JournalMode    string
	DatabaseSize   int64
	BackupsCount   int
	LastBackupAt   *time.Time // mtime of the newest backup by name
	BackupEveryMin int
}

// ReadHealth runs quick_check on the read pool, sums the database and WAL file sizes and looks at the backups.
// bk may be nil (no backups are configured).
func ReadHealth(st *store.Store, bk *store.Backups, everyMin int) Health {
	h := Health{JournalMode: st.JournalMode, BackupEveryMin: everyMin}
	verdict, err := st.IntegrityCheck()
	if err != nil {
		verdict = err.Error()
	}
	h.Integrity, h.DatabaseOK = verdict, verdict == "ok"
	for _, p := range []string{st.Path, st.Path + "-wal"} {
		if fi, err := os.Stat(p); err == nil {
			h.DatabaseSize += fi.Size()
		}
	}
	if bk != nil {
		files := bk.List()
		h.BackupsCount = len(files)
		if len(files) > 0 {
			if fi, err := os.Stat(files[0]); err == nil {
				t := fi.ModTime().UTC()
				h.LastBackupAt = &t
			}
		}
	}
	return h
}
