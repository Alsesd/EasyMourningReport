//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRestrictFilesTightensExistingData(t *testing.T) {
	data := t.TempDir()
	backups := filepath.Join(data, "backups")
	for dir, mode := range map[string]os.FileMode{backups: 0o755, filepath.Join(data, "tunnel"): 0o755} {
		if err := os.MkdirAll(dir, mode); err != nil {
			t.Fatal(err)
		}
		os.Chmod(dir, mode)
	}
	files := []string{filepath.Join(data, "reports.db"), filepath.Join(data, "reports.db-wal"), filepath.Join(data, "secret.key"), filepath.Join(backups, "reports-1.db")}
	for _, f := range files {
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		os.Chmod(f, 0o644)
	}
	restrictFiles(data, backups)
	for _, f := range files {
		if st, _ := os.Stat(f); st.Mode().Perm() != 0o600 {
			t.Errorf("%s is %v, want 0600", f, st.Mode().Perm())
		}
	}
	for _, d := range []string{backups, filepath.Join(data, "tunnel")} {
		if st, _ := os.Stat(d); st.Mode().Perm() != 0o700 {
			t.Errorf("%s is %v, want 0700", d, st.Mode().Perm())
		}
	}
	if st, _ := os.Stat(data); st.Mode().Perm() != 0o700 && st.Mode().Perm() != 0o755 && st.Mode().Perm() != 0o775 {
		t.Logf("the data folder itself is left as it was: %v", st.Mode().Perm())
	}
	// New files the program creates afterwards are private.
	fresh := filepath.Join(data, "new.db")
	os.WriteFile(fresh, []byte("x"), 0o666)
	if st, _ := os.Stat(fresh); st.Mode().Perm()&0o077 != 0 {
		t.Errorf("new file is %v, umask 077 not in effect", st.Mode().Perm())
	}
}
