package platform

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// testdata/passwords/python_hashes.json was produced with plain hashlib.pbkdf2_hmac
// (the algorithm of the original Python release), not by this code.
func TestPythonHashesVerifyInGo(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/passwords/python_hashes.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ PW, Hash string }
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if !CheckPassword(c.PW, c.Hash) {
			t.Errorf("python hash for %q does not verify", c.PW)
		}
		if CheckPassword(c.PW+"x", c.Hash) {
			t.Errorf("wrong password verified for %q", c.PW)
		}
		salt, _ := hex.DecodeString(strings.SplitN(c.Hash, "$", 2)[0])
		// Deliberate: the equality check now uses the legacy hasher (HashPassword writes the new format).
		got, err := LegacyHashPassword(c.PW, salt)
		if err != nil || got != c.Hash {
			t.Errorf("Go legacy hash differs from Python for %q: %s", c.PW, got)
		}
		if !NeedsRehash(c.Hash) {
			t.Errorf("a Python-era hash must be flagged for upgrade")
		}
	}
}

func TestHashFormatAndMalformed(t *testing.T) {
	h, err := HashPassword("x", nil)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(h, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" || parts[1] != "600000" || len(parts[2]) != 32 || len(parts[3]) != 64 {
		t.Fatalf("bad format %q", h)
	}
	if !CheckPassword("x", h) || CheckPassword("y", h) {
		t.Fatal("roundtrip failed")
	}
	if NeedsRehash(h) {
		t.Fatal("a current hash must not be flagged")
	}
	for _, bad := range []string{"", "nodollar", "zz$abc", "$", "pbkdf2_sha256$", "pbkdf2_sha256$600000$zz$aa",
		"pbkdf2_sha256$0$aa$bb", "pbkdf2_sha256$99999999999$aa$bb", "pbkdf2_sha256$600000$aa", "a$b$c"} {
		if CheckPassword("x", bad) {
			t.Errorf("malformed %q verified", bad)
		}
	}
}

func TestLegacyHashesStillVerifyAndAreFlagged(t *testing.T) {
	h, err := LegacyHashPassword("old-pass", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword("old-pass", h) || CheckPassword("new-pass", h) {
		t.Fatal("legacy verify failed")
	}
	if !NeedsRehash(h) || !NeedsRehash("garbage") {
		t.Fatal("legacy and malformed hashes need an upgrade")
	}
}

func TestDemoEnabled(t *testing.T) {
	for v, want := range map[string]bool{"": false, "0": false, "false": false, " Off ": false, "1": true, "true": true, "yes": true} {
		if got := demoEnabled(v); got != want {
			t.Errorf("demoEnabled(%q) = %v, want %v", v, got, want)
		}
	}
}
