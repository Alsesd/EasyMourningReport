package platform

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := b64.DecodeString(strings.Join(strings.Fields(s), ""))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// RFC 8291 section 5 and appendix A: the worked example. A round trip would only prove self-consistency; this proves
// that browsers (which implement the RFC) can decrypt what we send.
func TestEncryptPushMatchesRFC8291Example(t *testing.T) {
	plaintext := []byte("When I grow up, I want to be a watermelon")
	uaPublic := mustB64(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	auth := mustB64(t, "BTBZMqHH6r4Tts7J_aSIgg")
	salt := mustB64(t, "DGv6ra1nlYgDCS1FRnbzlw")
	sender, err := ecdh.P256().NewPrivateKey(mustB64(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := EncryptPush(plaintext, uaPublic, auth, salt, sender)
	if err != nil {
		t.Fatal(err)
	}
	want := mustB64(t, `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
		mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
		pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`)
	if string(got) != string(want) {
		t.Fatalf("body differs from the RFC example\n got %s\nwant %s", b64.EncodeToString(got), b64.EncodeToString(want))
	}
	// 86-byte header + 41 bytes of text + the 0x02 delimiter + the 16-byte tag. (The RFC prints Content-Length: 145,
	// but the body it shows, which matched byte for byte above, is 144 octets: a known slip in the example.)
	if len(got) != 144 {
		t.Fatalf("length %d", len(got))
	}
}

func TestEncryptPushRejectsABadKeyAndOversizePayloads(t *testing.T) {
	eph, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := EncryptPush([]byte("x"), []byte("not a key"), make([]byte, 16), make([]byte, 16), eph); err == nil {
		t.Fatal("a malformed subscription key must be refused")
	}
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := EncryptPush(make([]byte, 4000), ua.PublicKey().Bytes(), make([]byte, 16), make([]byte, 16), eph); err == nil {
		t.Fatal("a payload that does not fit one record must be refused")
	}
}

func TestVAPIDHeaderIsAVerifiableES256JWT(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ep, _ := url.Parse("https://fcm.googleapis.com/fcm/send/abc")
	now := time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)
	h, err := vapidAuthorization(key, ep, "https://example.org/contact", now)
	if err != nil {
		t.Fatal(err)
	}
	rest, ok := strings.CutPrefix(h, "vapid t=")
	jwt, k, ok2 := strings.Cut(rest, ", k=")
	if !ok || !ok2 {
		t.Fatalf("header shape: %s", h)
	}
	pub, _ := VAPIDPublicKey(key)
	if k != pub {
		t.Fatal("k must be the public key")
	}
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatal(jwt)
	}
	if string(mustB64(t, parts[0])) != `{"typ":"JWT","alg":"ES256"}` {
		t.Fatalf("header %s", mustB64(t, parts[0]))
	}
	claims := string(mustB64(t, parts[1]))
	for _, want := range []string{`"aud":"https://fcm.googleapis.com"`, `"sub":"https://example.org/contact"`, `"exp":` + itoa64(now.Add(12*time.Hour).Unix())} {
		if !strings.Contains(claims, want) {
			t.Fatalf("claims %s lack %s", claims, want)
		}
	}
	sig := mustB64(t, parts[2])
	if len(sig) != 64 { // raw r||s, not ASN.1
		t.Fatalf("signature is %d bytes, want 64", len(sig))
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(&key.PublicKey, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("signature does not verify")
	}
}

func TestVAPIDKeyIsCreatedOnceAndReused(t *testing.T) {
	dir := t.TempDir()
	none := func(string) string { return "" }
	a, err := LoadVAPIDKey(none, dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadVAPIDKey(none, dir)
	if err != nil {
		t.Fatal(err)
	}
	pa, _ := VAPIDPublicKey(a)
	pb, _ := VAPIDPublicKey(b)
	if pa != pb {
		t.Fatal("the key changed between starts: every subscription would break")
	}
	if fi, err := os.Stat(filepath.Join(dir, "vapid.key")); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("vapid.key: %v %v", fi, err)
	}
	d, _ := a.Bytes()
	env, err := LoadVAPIDKey(func(k string) string {
		if k == "VAPID_PRIVATE_KEY" {
			return b64.EncodeToString(d)
		}
		return ""
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if pe, _ := VAPIDPublicKey(env); pe != pa {
		t.Fatal("env override")
	}
}

func TestAllowedPushEndpoint(t *testing.T) {
	ok := []string{"https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x",
		"https://web.push.apple.com/Qx", "https://wns2-par02p.notify.windows.com/w/?token=x", "https://eu.push.apple.com/x"}
	bad := []string{"http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://10.0.0.5/x", "https://localhost/x",
		"https://fcm.googleapis.com:8443/x", "https://evil.example.com/x", "https://fcm.googleapis.com.evil.com/x",
		"https://user:pw@fcm.googleapis.com/x", "https://notify.windows.com.evil.net/x", "ftp://fcm.googleapis.com/x"}
	for _, s := range ok {
		u, _ := url.Parse(s)
		if err := AllowedPushEndpoint(u); err != nil {
			t.Errorf("%s: %v", s, err)
		}
	}
	for _, s := range bad {
		u, _ := url.Parse(s)
		if err := AllowedPushEndpoint(u); err == nil {
			t.Errorf("%s must be refused", s)
		}
	}
}

// A fake push service: checks the headers a real one needs, decrypts nothing (the RFC test covers that), and can
// answer 201, 410 or 500.
func TestSendPostsAVapidSignedEncryptedBodyAndReportsGoneSubscriptions(t *testing.T) {
	var got *http.Request
	var gotBody int
	status := 201
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		b := make([]byte, 8192)
		gotBody, _ = r.Body.Read(b)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	rand.Read(auth)
	sub := PushSubscription{Endpoint: srv.URL + "/send/abc", P256dh: b64.EncodeToString(ua.PublicKey().Bytes()), Auth: b64.EncodeToString(auth)}
	s := &PushSender{Key: key, Subject: "https://example.org", Allow: func(*url.URL) error { return nil }}
	if err := s.Send(context.Background(), sub, []byte(`{"title":"x"}`)); err != nil {
		t.Fatal(err)
	}
	if got.Method != "POST" || got.Header.Get("Content-Encoding") != "aes128gcm" || got.Header.Get("TTL") == "" ||
		!strings.HasPrefix(got.Header.Get("Authorization"), "vapid t=") || gotBody < 100 {
		t.Fatalf("request: %v body %d", got.Header, gotBody)
	}
	status = 410
	if err := s.Send(context.Background(), sub, []byte("x")); err != ErrSubscriptionGone {
		t.Fatalf("410: %v", err)
	}
	status = 500
	if err := s.Send(context.Background(), sub, []byte("x")); err == nil || err == ErrSubscriptionGone {
		t.Fatalf("500: %v", err)
	}
	// The default guard refuses a loopback address before anything is sent.
	hits := 0
	srv2 := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits++ }))
	defer srv2.Close()
	guarded := &PushSender{Key: key, Subject: "x"}
	sub.Endpoint = srv2.URL
	if err := guarded.Send(context.Background(), sub, []byte("x")); err == nil || hits != 0 {
		t.Fatalf("loopback endpoint was contacted (%d hits, err %v)", hits, err)
	}
}

func itoa64(n int64) string { return big.NewInt(n).String() }
