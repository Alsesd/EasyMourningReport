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
	"unicode"
)

const (
	pbkdf2Iterations = 600_000 // OWASP's figure for PBKDF2-HMAC-SHA256
	maxIterations    = 5_000_000
	hashPrefix       = "pbkdf2_sha256$"

	// MinPasswordLength applies to every password that is set or changed (existing passwords are not checked).
	MinPasswordLength = 8
)

// PasswordProblem returns why a new password is not acceptable ("" when it is): at least MinPasswordLength
// characters with a lowercase letter, an uppercase letter and a digit (any alphabet, Cyrillic included).
func PasswordProblem(pw string) string {
	var lower, upper, digit bool
	n := 0
	for _, r := range pw {
		n++
		switch {
		case unicode.IsLower(r):
			lower = true
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsDigit(r):
			digit = true
		}
	}
	switch {
	case n < MinPasswordLength:
		return "Пароль має містити щонайменше 8 символів."
	case !lower || !upper || !digit:
		return "Пароль має містити малі й великі літери та цифри."
	}
	return ""
}

// GeneratePassword makes a random password that satisfies PasswordProblem.
func GeneratePassword() (string, error) {
	const lower, upper, digits = "abcdefghjkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789"
	pick := func(set string) (byte, error) {
		b := make([]byte, 1)
		for {
			if _, err := rand.Read(b); err != nil {
				return 0, err
			}
			if int(b[0]) < 256-256%len(set) { // no modulo bias
				return set[int(b[0])%len(set)], nil
			}
		}
	}
	all := lower + upper + digits
	out := make([]byte, 12)
	for i := range out {
		set := all
		if i < 3 { // one of each class, then shuffled below
			set = []string{lower, upper, digits}[i]
		}
		c, err := pick(set)
		if err != nil {
			return "", err
		}
		out[i] = c
	}
	for i := len(out) - 1; i > 0; i-- { // Fisher-Yates
		j, err := pickIndex(i + 1)
		if err != nil {
			return "", err
		}
		out[i], out[j] = out[j], out[i]
	}
	return string(out), nil
}

func pickIndex(n int) (int, error) {
	b := make([]byte, 1)
	for {
		if _, err := rand.Read(b); err != nil {
			return 0, err
		}
		if int(b[0]) < 256-256%n {
			return int(b[0]) % n, nil
		}
	}
}

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

// NeedsRehash reports whether a stored hash is malformed or uses fewer iterations than today.
func NeedsRehash(stored string) bool {
	iterations, _, _, ok := parseHash(stored)
	return !ok || iterations < pbkdf2Iterations
}

// parseHash splits a stored hash into iterations, salt and the expected key.
func parseHash(stored string) (iterations int, salt []byte, key string, ok bool) {
	rest, found := strings.CutPrefix(stored, hashPrefix)
	if !found {
		return 0, nil, "", false
	}
	parts := strings.Split(rest, "$")
	if len(parts) != 3 {
		return 0, nil, "", false
	}
	n, err := strconv.Atoi(parts[0])
	if err != nil || n < 1 || n > maxIterations {
		return 0, nil, "", false
	}
	salt, err = hex.DecodeString(parts[1])
	if err != nil {
		return 0, nil, "", false
	}
	return n, salt, parts[2], true
}

// CheckPassword verifies pw against a stored hash. Malformed hashes simply fail.
func CheckPassword(pw, stored string) bool {
	iterations, salt, want, ok := parseHash(stored)
	if !ok {
		return false
	}
	got, err := derive(pw, salt, iterations)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}
