package core

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// NormName collapses runs of whitespace into single spaces and trims the ends. Names of organisations, roles and
// products are compared and stored this way, so every slice needs the same rule.
func NormName(raw string) string { return strings.Join(strings.Fields(raw), " ") }

// CleanName normalises a name and enforces 1..100 characters; what names the entity in the message.
func CleanName(raw, what string) (string, error) {
	n := NormName(raw)
	if n == "" {
		return "", errors.New(what + " не може бути порожньою")
	}
	if utf8.RuneCountInString(n) > 100 {
		return "", fmt.Errorf("%s задовга (до 100 символів)", what)
	}
	return n, nil
}
