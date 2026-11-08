package platform

import (
	"encoding/hex"
	"strings"
	"testing"
)

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

func TestWeakerHashesAreFlagged(t *testing.T) {
	salt := make([]byte, 16)
	key, _ := derive("Old-pass1", salt, 1000)
	h := hashPrefix + "1000$" + hex.EncodeToString(salt) + "$" + key
	if !CheckPassword("Old-pass1", h) || CheckPassword("New-pass1", h) {
		t.Fatal("a hash with fewer iterations must still verify")
	}
	if !NeedsRehash(h) || !NeedsRehash("garbage") {
		t.Fatal("weaker and malformed hashes need an upgrade")
	}
}

func TestDemoEnabled(t *testing.T) {
	for v, want := range map[string]bool{"": false, "0": false, "false": false, " Off ": false, "1": true, "true": true, "yes": true} {
		if got := demoEnabled(v); got != want {
			t.Errorf("demoEnabled(%q) = %v, want %v", v, got, want)
		}
	}
}
