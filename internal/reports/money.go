package reports

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
	"unicode"
)

// ErrBadPrice is the form error "Некоректна ціна. Приклад: 25.50".
var ErrBadPrice = errors.New("Некоректна ціна. Приклад: 25.50")

const maxCents = 1_000_000_000

var decimalSyntax = regexp.MustCompile(`^([+-]?)(\d(?:_?\d)*)?(?:\.(\d(?:_?\d)*)?)?(?:[eE]([+-]?\d(?:_?\d)*))?$`)

// asciiDigits maps every Unicode decimal digit (category Nd) to its ASCII digit, as Python's
// Decimal accepts them ("١٢" is 12). Other runes are kept.
func asciiDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r > unicode.MaxASCII && unicode.IsDigit(r) {
			b.WriteByte(byte('0' + digitValue(r)))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func digitValue(r rune) int {
	if r >= 0x1D7CE && r <= 0x1D7FF { // mathematical digits: five runs of ten
		return int(r-0x1D7CE) % 10
	}
	n := 0
	for n < 9 && unicode.IsDigit(r-rune(n)-1) {
		n++
	}
	return n
}

// ToCents parses a price like Python's core.dependencies.to_cents: spaces removed, "," as the
// decimal point, Decimal syntax (underscores, exponents, Unicode digits), rounded half-to-even
// to whole cents, 0..1_000_000_000. NaN/Infinity and anything unparseable is ErrBadPrice.
func ToCents(raw string) (int64, error) {
	s := strings.TrimSpace(raw)
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ",", ".")
	s = asciiDigits(s)
	m := decimalSyntax.FindStringSubmatch(s)
	if m == nil || (m[2] == "" && m[3] == "") {
		return 0, ErrBadPrice
	}
	neg := m[1] == "-"
	intPart := strings.ReplaceAll(m[2], "_", "")
	frac := strings.ReplaceAll(m[3], "_", "")
	digits := strings.TrimLeft(intPart+frac, "0")
	exp := 0
	if m[4] != "" {
		e := strings.ReplaceAll(m[4], "_", "")
		var ok bool
		exp, ok = parseExp(e)
		if !ok {
			return 0, ErrBadPrice
		}
	}
	if digits == "" { // zero (negative zero included)
		return 0, nil
	}
	mant, _ := new(big.Int).SetString(digits, 10)
	// value in cents = mant * 10^(exp - len(frac) + 2)
	shift := exp - len(frac) + 2
	var cents *big.Int
	switch {
	case shift >= 0:
		if shift > 12 || len(digits)+shift > 13 {
			return 0, ErrBadPrice
		}
		cents = new(big.Int).Mul(mant, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(shift)), nil))
	case -shift > len(digits)+1:
		cents = big.NewInt(0) // magnitude below 0.01 of a cent: rounds to zero
	default:
		div := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-shift)), nil)
		q, r := new(big.Int).QuoRem(mant, div, new(big.Int))
		twice := new(big.Int).Mul(r, big.NewInt(2))
		switch c := twice.Cmp(div); {
		case c > 0, c == 0 && q.Bit(0) == 1:
			q.Add(q, big.NewInt(1))
		}
		cents = q
	}
	if !cents.IsInt64() || cents.Int64() > maxCents {
		return 0, ErrBadPrice
	}
	v := cents.Int64()
	if neg && v > 0 {
		return 0, ErrBadPrice
	}
	return v, nil
}

func parseExp(e string) (int, bool) {
	sign := 1
	if e[0] == '+' || e[0] == '-' {
		if e[0] == '-' {
			sign = -1
		}
		e = e[1:]
	}
	e = strings.TrimLeft(e, "0")
	if len(e) > 6 { // beyond Decimal's own exponent range
		return 0, false
	}
	n := 0
	for _, c := range e {
		n = n*10 + int(c-'0')
	}
	return sign * n, true
}

// FormatMoney renders integer cents like Python's f"{cents / 100:.2f}".
func FormatMoney(cents int64) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	s := new(big.Int).SetInt64(cents).String()
	for len(s) < 3 {
		s = "0" + s
	}
	out := s[:len(s)-2] + "." + s[len(s)-2:]
	if neg {
		out = "-" + out
	}
	return out
}

// FormatInt renders an int64 in decimal.
func FormatInt(n int64) string { return new(big.Int).SetInt64(n).String() }
