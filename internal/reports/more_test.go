package reports

import "testing"

func TestSmallHelpers(t *testing.T) {
	if FormatInt(-12345678901234) != "-12345678901234" || itoa(42) != "42" {
		t.Fatal("number formatting")
	}
	if (&ImportFailure{Detail: "x"}).Error() != "x" {
		t.Fatal("ImportFailure")
	}
}
