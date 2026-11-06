// Package platform holds accounts, roles and bootstrap logic shared by every module.
package platform

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strconv"
	"strings"
)

const (
	legacyIterations = 200_000
	pbkdf2Iterations = 600_000 // OWASP's figure for PBKDF2-HMAC-SHA256
	maxIterations    = 5_000_000
	hashPrefix       = "pbkdf2_sha256$"

	// MinPasswordLength applies to every password that is set or changed (existing passwords are not checked).
	MinPasswordLength = 10
)

func derive(pw string, salt []byte, iterations int) (string, error) {
	key, err := pbkdf2.Key(sha256.New, pw, salt, iterations, 32)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(key), nil
}

func newSalt() ([]byte, error) {
	salt := make([]byte, 16)
	_, err := rand.Read(salt)
	return salt, err
}

// HashPassword returns "pbkdf2_sha256$<iterations>$<salthex>$<hashhex>" (16-byte salt, 600k iterations).
// A nil salt generates a random one.
func HashPassword(pw string, salt []byte) (string, error) {
	if salt == nil {
		var err error
		if salt, err = newSalt(); err != nil {
			return "", err
		}
	}
	key, err := derive(pw, salt, pbkdf2Iterations)
	if err != nil {
		return "", err
	}
	return hashPrefix + strconv.Itoa(pbkdf2Iterations) + "$" + hex.EncodeToString(salt) + "$" + key, nil
}

// LegacyHashPassword returns the "salthex$hashhex" format (200k iterations) of the original Python release.
// It is kept only to prove that old hashes verify and for tests; nothing new is written in this format.
func LegacyHashPassword(pw string, salt []byte) (string, error) {
	if salt == nil {
		var err error
		if salt, err = newSalt(); err != nil {
			return "", err
		}
	}
	key, err := derive(pw, salt, legacyIterations)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(salt) + "$" + key, nil
}

// NeedsRehash reports whether a stored hash is in the legacy format or uses fewer iterations than today.
func NeedsRehash(stored string) bool {
	_, iterations, _, _, ok := parseHash(stored)
	return !ok || iterations < pbkdf2Iterations
}

// parseHash splits either format into iterations, salt and the expected key.
func parseHash(stored string) (legacy bool, iterations int, salt []byte, key string, ok bool) {
	if rest, found := strings.CutPrefix(stored, hashPrefix); found {
		parts := strings.Split(rest, "$")
		if len(parts) != 3 {
			return false, 0, nil, "", false
		}
		n, err := strconv.Atoi(parts[0])
		if err != nil || n < 1 || n > maxIterations {
			return false, 0, nil, "", false
		}
		salt, err := hex.DecodeString(parts[1])
		if err != nil {
			return false, 0, nil, "", false
		}
		return false, n, salt, parts[2], true
	}
	saltHex, key, found := strings.Cut(stored, "$")
	if !found || strings.Contains(key, "$") {
		return true, 0, nil, "", false
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return true, 0, nil, "", false
	}
	return true, legacyIterations, salt, key, true
}

// CheckPassword verifies pw against a stored hash in either format. Malformed hashes simply fail.
func CheckPassword(pw, stored string) bool {
	_, iterations, salt, want, ok := parseHash(stored)
	if !ok {
		return false
	}
	got, err := derive(pw, salt, iterations)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}
