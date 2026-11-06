//go:build !windows

package main

import (
	"log"
	"os"
	"path/filepath"
	"syscall"
)

// restrictFiles makes everything the program creates private to its user (umask 077) and tightens what
// already exists: the database and its WAL files, the backups and the tunnel state. It does not touch the
// permissions of the program's own folder.
func restrictFiles(dataDir, backupsDir string) {
	syscall.Umask(0o077)
	for _, f := range []string{"reports.db", "reports.db-wal", "reports.db-shm", "secret.key"} {
		chmodIfExists(filepath.Join(dataDir, f), 0o600)
	}
	chmodIfExists(filepath.Join(dataDir, "tunnel"), 0o700)
	chmodIfExists(backupsDir, 0o700)
	if entries, err := os.ReadDir(backupsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				chmodIfExists(filepath.Join(backupsDir, e.Name()), 0o600)
			}
		}
	}
}

func chmodIfExists(path string, mode os.FileMode) {
	st, err := os.Stat(path)
	if err != nil || st.Mode().Perm() == mode {
		return
	}
	if err := os.Chmod(path, mode); err != nil {
		log.Printf("warning: could not restrict %s: %v", path, err)
	}
}
