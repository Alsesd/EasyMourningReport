// Package config resolves paths and environment settings exactly like
// backend/app/core/paths.py, db/session.py and db/backup.py.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const AppName = "LegkyiZvit"

// Config holds everything Slice 1 needs from the environment.
type Config struct {
	Host         string
	Port         string
	DataDir      string
	BackupsDir   string
	JournalWant  string // SQLITE_JOURNAL_MODE: wal | delete | auto
	BackupKeep   int
	BackupEveryM int
}

// DBPath is the live database file.
func (c Config) DBPath() string { return filepath.Join(c.DataDir, "reports.db") }

// Getenv abstracts os.Getenv for tests.
type Getenv func(string) string

// Load builds the configuration. appDir is the folder of the executable.
func Load(getenv Getenv, appDir string) (Config, error) {
	dataDir, err := DataDir(getenv, appDir)
	if err != nil {
		return Config{}, err
	}
	backups := dataDir + string(filepath.Separator) + "backups"
	if raw := getenv("LEGKYI_BACKUPS_DIR"); raw != "" {
		backups = cleanPath(raw)
	}
	keep := atoiDefault(getenv("BACKUP_KEEP"), 100)
	if keep < 1 {
		keep = 1
	}
	every := atoiDefault(getenv("BACKUP_EVERY_MIN"), 60)
	if every < 1 {
		every = 1
	}
	return Config{
		Host:         orDefault(getenv("HOST"), "127.0.0.1"),
		Port:         orDefault(getenv("PORT"), "8000"),
		DataDir:      dataDir,
		BackupsDir:   filepath.Clean(backups),
		JournalWant:  strings.ToLower(strings.TrimSpace(orDefault(getenv("SQLITE_JOURNAL_MODE"), "auto"))),
		BackupKeep:   keep,
		BackupEveryM: every,
	}, nil
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func atoiDefault(v string, d int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
		return n
	}
	return d
}

// cleanPath mirrors _clean_path: strip blanks and quotes, expand "~", make absolute.
func cleanPath(raw string) string {
	s := strings.Trim(strings.TrimSpace(raw), "\"'")
	if s == "~" || strings.HasPrefix(s, "~/") || strings.HasPrefix(s, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			s = filepath.Join(home, s[1:])
		}
	}
	if abs, err := filepath.Abs(s); err == nil {
		s = abs
	}
	if resolved, err := filepath.EvalSymlinks(s); err == nil {
		s = resolved
	}
	return s
}

// DataDir: 1. LEGKYI_DATA_DIR (must be creatable), 2. the exe folder when writable,
// 3. the per-user application data folder.
func DataDir(getenv Getenv, appDir string) (string, error) {
	if override := getenv("LEGKYI_DATA_DIR"); override != "" {
		folder := cleanPath(override)
		if err := os.MkdirAll(folder, 0o755); err != nil {
			return "", fmt.Errorf("data dir %s: %w", folder, err) // an explicit setting fails loudly
		}
		return folder, nil
	}
	if writable(appDir) {
		return appDir, nil
	}
	fallback := userDataDir(getenv, runtime.GOOS)
	if err := os.MkdirAll(fallback, 0o755); err != nil {
		return "", fmt.Errorf("data dir %s: %w", fallback, err)
	}
	return fallback, nil
}

func userDataDir(getenv Getenv, goos string) string {
	home, _ := os.UserHomeDir()
	var root string
	if goos == "windows" {
		root = getenv("LOCALAPPDATA")
		if root == "" {
			root = filepath.Join(home, "AppData", "Local")
		}
	} else {
		root = getenv("XDG_DATA_HOME")
		if root == "" {
			root = filepath.Join(home, ".local", "share")
		}
	}
	return filepath.Join(root, AppName)
}

func writable(folder string) bool {
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return false
	}
	probe := filepath.Join(folder, fmt.Sprintf(".write-test-%d", os.Getpid()))
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return false
	}
	_ = os.Remove(probe)
	return true
}

// sharedFilesystems are mounts where SQLite's WAL shared memory is unreliable.
var sharedFilesystems = map[string]bool{
	"9p": true, "cifs": true, "smb3": true, "smbfs": true, "nfs": true, "nfs4": true,
	"drvfs": true, "virtiofs": true, "fakeowner": true, "fuse.grpcfuse": true,
	"fuse.sshfs": true, "fuse.osxfs": true, "vboxsf": true,
}

// FilesystemType is the filesystem type of the mount holding path ("" when unknown).
func FilesystemType(path, mountsFile string) string {
	data, err := os.ReadFile(mountsFile)
	if err != nil {
		return ""
	}
	target := path
	if r, err := filepath.EvalSymlinks(path); err == nil {
		target = r
	}
	if abs, err := filepath.Abs(target); err == nil {
		target = abs
	}
	best, fstype := "", ""
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		mp := strings.ReplaceAll(parts[1], `\040`, " ")
		inside := target == mp || strings.HasPrefix(target, strings.TrimRight(mp, "/")+"/")
		if inside && len(mp) >= len(best) {
			best, fstype = mp, parts[2]
		}
	}
	return fstype
}

// JournalMode: wal | delete. "auto" picks delete on shared Linux mounts, wal otherwise
// (so Windows always gets wal, as in Python).
func JournalMode(want, folder, goos, mountsFile string) string {
	if want == "wal" || want == "delete" {
		return want
	}
	if goos == "linux" && sharedFilesystems[FilesystemType(folder, mountsFile)] {
		return "delete"
	}
	return "wal"
}

// LoadEnvFile loads KEY=VALUE lines without overriding exported variables.
func LoadEnvFile(path string, lookup func(string) (string, bool), set func(k, v string)) error {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), "\"'")
		if _, ok := lookup(k); k != "" && !ok {
			set(k, v)
		}
	}
	return sc.Err()
}
