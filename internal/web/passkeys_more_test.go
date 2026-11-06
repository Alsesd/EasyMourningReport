package web

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCoseKeys(t *testing.T) {
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	good := map[any]any{int64(1): int64(3), int64(3): int64(-257), int64(-1): rsaKey.N.Bytes(), int64(-2): big.NewInt(int64(rsaKey.E)).Bytes()}
	der, err := coseToPublicKey(good)
	if err != nil {
		t.Fatal(err)
	}
	// An RS256 signature verifies through the stored key; a different message does not.
	msg := []byte("signed data")
	d := sha256.Sum256(msg)
	sig, _ := rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, d[:])
	if !verifySignature(der, msg, sig) || verifySignature(der, []byte("other"), sig) {
		t.Fatal("RS256 verification")
	}
	if verifySignature([]byte("not a key"), msg, sig) {
		t.Fatal("garbage key")
	}
	edKey, _ := x509.MarshalPKIXPublicKey(rsaKey.Public())
	_ = edKey
	bad := map[string]map[any]any{
		"unknown type":   {int64(1): int64(1), int64(3): int64(-8)},
		"bad curve":      {int64(1): int64(2), int64(3): int64(-7), int64(-1): int64(2), int64(-2): make([]byte, 32), int64(-3): make([]byte, 32)},
		"short ec x":     {int64(1): int64(2), int64(3): int64(-7), int64(-1): int64(1), int64(-2): []byte{1}, int64(-3): make([]byte, 32)},
		"off-curve ec":   {int64(1): int64(2), int64(3): int64(-7), int64(-1): int64(1), int64(-2): make([]byte, 32), int64(-3): make([]byte, 32)},
		"short rsa n":    {int64(1): int64(3), int64(3): int64(-257), int64(-1): []byte{1, 2}, int64(-2): []byte{1, 0, 1}},
		"empty exponent": {int64(1): int64(3), int64(3): int64(-257), int64(-1): rsaKey.N.Bytes(), int64(-2): []byte{}},
		"tiny exponent":  {int64(1): int64(3), int64(3): int64(-257), int64(-1): rsaKey.N.Bytes(), int64(-2): []byte{1}},
	}
	for name, m := range bad {
		if _, err := coseToPublicKey(m); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestRelyingPartyPinning(t *testing.T) {
	e := newEnv(t, func(d *Deps) { d.PasskeyRPID = "example.org" })
	a := &App{Deps: Deps{PasskeyRPID: "example.org"}}
	_ = e
	req := func(origin string) *http.Request {
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Origin", origin)
		return r
	}
	if rp, _, err := a.relyingParty(req("https://app.example.org")); err != nil || rp != "example.org" {
		t.Fatalf("subdomain of the pinned id: %q %v", rp, err)
	}
	if _, _, err := a.relyingParty(req("https://evil.test")); err == nil {
		t.Fatal("a host outside the pinned id")
	}
	if _, _, err := a.relyingParty(req("http://localhost:8000")); err == nil {
		t.Fatal("localhost is outside the pinned id")
	}
	open := &App{}
	if rp, _, err := open.relyingParty(req("http://localhost:8000")); err != nil || rp != "localhost" {
		t.Fatalf("localhost is allowed over http when nothing is pinned: %q %v", rp, err)
	}
	if _, _, err := a.relyingParty(req("::bad")); err == nil {
		t.Fatal("unparsable origin")
	}
}

func TestParseAuthDataRejectsMalformedInput(t *testing.T) {
	good := authHeader("h", flagUP|flagUV, 1)
	if _, err := parseAuthData(good[:10], "h", false); err == nil {
		t.Fatal("short")
	}
	if _, err := parseAuthData(good, "other", false); err == nil {
		t.Fatal("wrong rp id")
	}
	if _, err := parseAuthData(authHeader("h", flagUP, 1), "h", false); err == nil {
		t.Fatal("no user verification")
	}
	if _, err := parseAuthData(good, "h", true); err == nil {
		t.Fatal("no attested credential data")
	}
	withAT := append(authHeader("h", flagUP|flagUV|flagAT, 0), make([]byte, 16)...)
	withAT = append(withAT, 0, 0) // credential id length 0
	if _, err := parseAuthData(withAT, "h", true); err == nil {
		t.Fatal("empty credential id")
	}
}
