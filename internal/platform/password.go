// Package platform holds accounts, roles and bootstrap logic shared by every module.
package platform

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

const pbkdf2Iterations = 200_000

// HashPassword returns "salthex$hashhex" (16-byte salt, PBKDF2-HMAC-SHA256, 200k iterations),
// the PBKDF2 format of the original Python release (existing hashes keep working). A nil salt generates a random one.
func HashPassword(pw string, salt []byte) (string, error) {
	if salt == nil {
		salt = make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return "", err
		}
	}
	key, err := pbkdf2.Key(sha256.New, pw, salt, pbkdf2Iterations, 32)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(salt) + "$" + hex.EncodeToString(key), nil
}

// CheckPassword verifies pw against a stored hash. Malformed hashes simply fail.
func CheckPassword(pw, stored string) bool {
	saltHex, _, ok := strings.Cut(stored, "$")
	if !ok {
		return false
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	got, err := HashPassword(pw, salt)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(stored)) == 1
}
