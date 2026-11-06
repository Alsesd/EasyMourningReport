package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDBPathAndDefaults(t *testing.T) {
	if got := (Config{DataDir: "/d"}).DBPath(); got != filepath.Join("/d", "reports.db") {
		t.Fatal(got)
	}
	if orDefault("", "x") != "x" || orDefault("y", "x") != "y" {
		t.Fatal("orDefault")
	}
}

func TestDataDirChoices(t *testing.T) {
	none := func(string) string { return "" }
	writableDir := t.TempDir()
	if got, err := DataDir(none, writableDir); err != nil || got != writableDir {
		t.Fatalf("next to the program: %q %v", got, err)
	}
	override := filepath.Join(t.TempDir(), "made", "here")
	if got, err := DataDir(func(k string) string {
		if k == "LEGKYI_DATA_DIR" {
			return override
		}
		return ""
	}, writableDir); err != nil || got == "" {
		t.Fatalf("override: %q %v", got, err)
	}
	if _, err := os.Stat(override); err != nil {
		t.Fatal("the override folder must be created")
	}
	// An override that cannot be created fails loudly.
	file := filepath.Join(t.TempDir(), "file")
	os.WriteFile(file, []byte("x"), 0o644)
	if _, err := DataDir(func(k string) string {
		if k == "LEGKYI_DATA_DIR" {
			return filepath.Join(file, "sub")
		}
		return ""
	}, writableDir); err == nil {
		t.Fatal("an unusable override must be an error")
	}
	// A program folder that is not writable falls back to the per-user folder.
	home := t.TempDir()
	got, err := DataDir(func(k string) string {
		if k == "XDG_DATA_HOME" || k == "LOCALAPPDATA" {
			return home
		}
		return ""
	}, filepath.Join(file, "nope"))
	if err != nil || filepath.Dir(got) != home {
		t.Fatalf("fallback: %q %v", got, err)
	}
}

func TestUserDataDirPerPlatform(t *testing.T) {
	env := func(k string) string {
		switch k {
		case "LOCALAPPDATA":
			return `C:\L`
		case "XDG_DATA_HOME":
			return "/x"
		}
		return ""
	}
	if got := userDataDir(env, "windows"); filepath.Base(got) != AppName {
		t.Fatal(got)
	}
	if got := userDataDir(env, "linux"); got != filepath.Join("/x", AppName) {
		t.Fatal(got)
	}
	none := func(string) string { return "" }
	for _, goos := range []string{"windows", "linux"} {
		if got := userDataDir(none, goos); filepath.Base(got) != AppName {
			t.Fatal(got)
		}
	}
}

func TestWritable(t *testing.T) {
	if !writable(t.TempDir()) {
		t.Fatal("a temp dir is writable")
	}
	file := filepath.Join(t.TempDir(), "f")
	os.WriteFile(file, nil, 0o644)
	if writable(filepath.Join(file, "x")) {
		t.Fatal("below a file is not writable")
	}
}
