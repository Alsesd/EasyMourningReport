package config

import (
	"os"
	"path/filepath"
	"testing"
)

func env(m map[string]string) Getenv { return func(k string) string { return m[k] } }

func TestDataDirOverrideAndBackups(t *testing.T) {
	d := filepath.Join(t.TempDir(), "data")
	cfg, err := Load(env(map[string]string{"LEGKYI_DATA_DIR": `"` + d + `"`, "BACKUP_KEEP": "0", "BACKUP_EVERY_MIN": "x"}), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DataDir != d || cfg.BackupsDir != filepath.Join(d, "backups") {
		t.Fatalf("%+v", cfg)
	}
	if cfg.BackupKeep != 1 || cfg.BackupEveryM != 60 || cfg.Host != "127.0.0.1" || cfg.Port != "8000" {
		t.Fatalf("defaults wrong: %+v", cfg)
	}
	if _, err := os.Stat(d); err != nil {
		t.Fatal("explicit data dir must be created")
	}
	other := t.TempDir()
	cfg, _ = Load(env(map[string]string{"LEGKYI_DATA_DIR": d, "LEGKYI_BACKUPS_DIR": "'" + other + "'"}), "")
	if cfg.BackupsDir != other {
		t.Fatal(cfg.BackupsDir)
	}
}

func TestDataDirFallsBackWhenAppDirReadOnly(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can write anywhere")
	}
	ro := filepath.Join(t.TempDir(), "ro")
	os.Mkdir(ro, 0o555)
	xdg := t.TempDir()
	got, err := DataDir(env(map[string]string{"XDG_DATA_HOME": xdg}), ro)
	if err != nil || got != filepath.Join(xdg, AppName) {
		t.Fatalf("%q %v", got, err)
	}
	app := t.TempDir()
	if got, _ := DataDir(env(nil), app); got != app {
		t.Fatalf("writable app dir should win, got %q", got)
	}
}

func TestUserDataDirWindows(t *testing.T) {
	got := userDataDir(env(map[string]string{"LOCALAPPDATA": `C:\L`}), "windows")
	if filepath.Base(got) != AppName {
		t.Fatal(got)
	}
}

const mounts = `rootfs / rootfs rw 0 0
/dev/sda1 / ext4 rw 0 0
//srv/share /mnt/my\040share cifs rw 0 0
host /srv/shared 9p rw 0 0
`

func TestJournalMode(t *testing.T) {
	mf := filepath.Join(t.TempDir(), "mounts")
	os.WriteFile(mf, []byte(mounts), 0o644)
	cases := []struct{ want, folder, goos, exp string }{
		{"auto", "/home/x", "linux", "wal"},
		{"auto", "/mnt/my share/data", "linux", "delete"},
		{"auto", "/srv/shared", "linux", "delete"},
		{"auto", "/srv/sharedx", "linux", "wal"},
		{"auto", "/mnt/my share/data", "windows", "wal"},
		{"delete", "/home/x", "linux", "delete"},
		{"wal", "/srv/shared", "linux", "wal"},
		{"bogus", "/home/x", "linux", "wal"},
	}
	for _, c := range cases {
		if got := JournalMode(c.want, c.folder, c.goos, mf); got != c.exp {
			t.Errorf("%+v got %s", c, got)
		}
	}
	if got := JournalMode("auto", "/mnt", "linux", "/nonexistent"); got != "wal" {
		t.Fatal(got)
	}
}

func TestLoadEnvFileDoesNotOverride(t *testing.T) {
	f := filepath.Join(t.TempDir(), ".env")
	os.WriteFile(f, []byte("# c\nA=1\nB = \"two\"\nbad line\nC=3\n"), 0o644)
	set := map[string]string{}
	lookup := func(k string) (string, bool) { v, ok := map[string]string{"C": "kept"}[k]; return v, ok }
	if err := LoadEnvFile(f, lookup, func(k, v string) { set[k] = v }); err != nil {
		t.Fatal(err)
	}
	if set["A"] != "1" || set["B"] != "two" || len(set) != 2 {
		t.Fatalf("%v", set)
	}
	if err := LoadEnvFile(filepath.Join(t.TempDir(), "none"), lookup, nil); err != nil {
		t.Fatal("missing file must be fine")
	}
}
