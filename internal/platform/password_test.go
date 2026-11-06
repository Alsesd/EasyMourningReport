package platform

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// testdata/passwords/python_hashes.json was produced with plain hashlib.pbkdf2_hmac
// (the algorithm of backend/app/core/security.py hash_pw), not by this code.
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
		got, err := HashPassword(c.PW, salt)
		if err != nil || got != c.Hash {
			t.Errorf("Go hash differs from Python for %q: %s", c.PW, got)
		}
	}
}

func TestHashFormatAndMalformed(t *testing.T) {
	h, err := HashPassword("x", nil)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(h, "$")
	if len(parts) != 2 || len(parts[0]) != 32 || len(parts[1]) != 64 {
		t.Fatalf("bad format %q", h)
	}
	if !CheckPassword("x", h) {
		t.Fatal("roundtrip failed")
	}
	for _, bad := range []string{"", "nodollar", "zz$abc", "$"} {
		if CheckPassword("x", bad) {
			t.Errorf("malformed %q verified", bad)
		}
	}
}
