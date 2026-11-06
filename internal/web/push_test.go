package web

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"legkyi/internal/platform"
)

var pb64 = base64.RawURLEncoding

// browser plays the receiving side: it owns the subscription keys and can decrypt what the server sends.
type browser struct {
	priv *ecdh.PrivateKey
	auth []byte
}

func newBrowser(t *testing.T) *browser {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	rand.Read(auth)
	return &browser{priv, auth}
}

func (b *browser) subscription(endpoint string) map[string]any {
	return map[string]any{"endpoint": endpoint, "keys": map[string]string{
		"p256dh": pb64.EncodeToString(b.priv.PublicKey().Bytes()), "auth": pb64.EncodeToString(b.auth)}}
}

// decrypt reverses RFC 8291 the way a browser does.
func (b *browser) decrypt(t *testing.T, body []byte) []byte {
	t.Helper()
	salt, idlen := body[:16], int(body[20])
	asPub := body[21 : 21+idlen]
	cipherText := body[21+idlen:]
	as, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := b.priv.ECDH(as)
	prkKey, _ := hkdf.Extract(sha256.New, shared, b.auth)
	ikm, _ := hkdf.Expand(sha256.New, prkKey, "WebPush: info\x00"+string(b.priv.PublicKey().Bytes())+string(asPub), 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	blk, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(blk)
	plain, err := gcm.Open(nil, nonce, cipherText, nil)
	if err != nil {
		t.Fatalf("the browser could not decrypt the push: %v", err)
	}
	return plain[:len(plain)-1] // drop the 0x02 delimiter
}

// pushService is a fake push service: it records what it receives and answers with a settable status.
type pushService struct {
	srv    *httptest.Server
	mu     sync.Mutex
	got    map[string][][]byte // path -> bodies
	status map[string]int
}

func newPushService(t *testing.T) *pushService {
	p := &pushService{got: map[string][][]byte{}, status: map[string]int{}}
	p.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		p.mu.Lock()
		defer p.mu.Unlock()
		p.got[r.URL.Path] = append(p.got[r.URL.Path], b)
		if st := p.status[r.URL.Path]; st != 0 {
			w.WriteHeader(st)
			return
		}
		w.WriteHeader(201)
	}))
	t.Cleanup(p.srv.Close)
	return p
}

func (p *pushService) bodies(path string) [][]byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.got[path]
}

func pushDeps(d *Deps) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	d.Push = &platform.PushSender{Key: key, Subject: "https://example.org", Allow: func(*url.URL) error { return nil }}
}

func (d *desks) ownedSubscriptions() int {
	return count(d.e, "SELECT COUNT(*) FROM push_subscriptions")
}

func TestPushKeyAndSubscriptionEndpoints(t *testing.T) {
	// Not configured: an empty key, and a subscription is refused.
	off := newDesks(t)
	var k pushKeyDTO
	json.Unmarshal(off.e.do("GET", "/api/v1/push/key", "", nil, off.a).Body.Bytes(), &k)
	if k.PublicKey != "" {
		t.Fatalf("key while off: %q", k.PublicKey)
	}
	if w := off.post(off.a, "POST", "/api/v1/push/subscriptions", newBrowser(t).subscription("https://fcm.googleapis.com/x")); w.Code != 404 {
		t.Fatalf("off: %d", w.Code)
	}

	d := newDesksWith(t, pushDeps)
	json.Unmarshal(d.e.do("GET", "/api/v1/push/key", "", nil, d.a).Body.Bytes(), &k)
	if raw, err := pb64.DecodeString(k.PublicKey); err != nil || len(raw) != 65 {
		t.Fatalf("public key %q", k.PublicKey)
	}
	if w := d.e.do("GET", "/api/v1/push/key", "", nil); w.Code != 401 {
		t.Fatalf("anonymous key: %d", w.Code)
	}
	br := newBrowser(t)
	// The default allowlist is replaced in tests, so check the validators that stay: keys must be real.
	bad := br.subscription("https://fcm.googleapis.com/x")
	bad["keys"].(map[string]string)["p256dh"] = pb64.EncodeToString([]byte("not a point"))
	if w := d.post(d.a, "POST", "/api/v1/push/subscriptions", bad); w.Code != 422 {
		t.Fatalf("bad key: %d %s", w.Code, w.Body)
	}
	short := br.subscription("https://fcm.googleapis.com/x")
	short["keys"].(map[string]string)["auth"] = pb64.EncodeToString([]byte("short"))
	if w := d.post(d.a, "POST", "/api/v1/push/subscriptions", short); w.Code != 422 {
		t.Fatalf("short auth: %d", w.Code)
	}
	good := br.subscription("https://fcm.googleapis.com/fcm/send/abc")
	if w := d.post(d.a, "POST", "/api/v1/push/subscriptions", good); w.Code != 200 || d.ownedSubscriptions() != 1 {
		t.Fatalf("subscribe: %d %s", w.Code, w.Body)
	}
	// The same browser used by another person moves to that person (and to nobody else).
	d.post(d.b, "POST", "/api/v1/push/subscriptions", good)
	if n := count(d.e, "SELECT COUNT(*) FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.login = 'desk_b'"); n != 1 || d.ownedSubscriptions() != 1 {
		t.Fatalf("a shared browser must belong to the last person who signed in (rows %d)", d.ownedSubscriptions())
	}
	// Only the owner can delete it.
	d.e.do("DELETE", "/api/v1/push/subscriptions?endpoint="+url.QueryEscape("https://fcm.googleapis.com/fcm/send/abc"), "", nil, d.a)
	if d.ownedSubscriptions() != 1 {
		t.Fatal("another user deleted a subscription that is not theirs")
	}
	d.e.do("DELETE", "/api/v1/push/subscriptions?endpoint="+url.QueryEscape("https://fcm.googleapis.com/fcm/send/abc"), "", nil, d.b)
	if d.ownedSubscriptions() != 0 {
		t.Fatal("delete")
	}
}

func TestSubscriptionEndpointMustBeAKnownPushService(t *testing.T) {
	// Real guard (no Allow override): http, loopback and unknown hosts are refused before anything is stored.
	d := newDesksWith(t, func(d *Deps) {
		key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		d.Push = &platform.PushSender{Key: key, Subject: "x"}
	})
	br := newBrowser(t)
	for _, ep := range []string{"http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.example.com/x", "https://10.1.2.3/x"} {
		if w := d.post(d.a, "POST", "/api/v1/push/subscriptions", br.subscription(ep)); w.Code != 422 {
			t.Fatalf("%s: %d", ep, w.Code)
		}
	}
	if d.ownedSubscriptions() != 0 {
		t.Fatal("a refused endpoint was stored")
	}
	if w := d.post(d.a, "POST", "/api/v1/push/subscriptions", br.subscription("https://updates.push.services.mozilla.com/wpush/v2/abc")); w.Code != 200 {
		t.Fatalf("a Mozilla endpoint must be accepted: %d", w.Code)
	}
}

func TestDispatcherDeliversNewNotificationsToTheRecipientsBrowsersOnly(t *testing.T) {
	svc := newPushService(t)
	d := newDesksWith(t, pushDeps)
	a := &App{Deps: d.e.depsForTest()}
	d.e.addUser("disp", "Диспетчер", "Disp-pass1", nil, "platform", "transport.orders.manage")
	disp := sessionCookie(d.e.login("disp", "Disp-pass1"))
	dispBrowser, otherBrowser := newBrowser(t), newBrowser(t)
	d.post(disp, "POST", "/api/v1/push/subscriptions", dispBrowser.subscription(svc.srv.URL+"/disp"))
	d.post(d.b, "POST", "/api/v1/push/subscriptions", otherBrowser.subscription(svc.srv.URL+"/other"))

	d.create(d.a, order(day, "Іваненко І. І.", "d09:30")) // notifies the dispatcher
	if n, err := a.pushPass(context.Background()); err != nil || n == 0 {
		t.Fatalf("pass: %d %v", n, err)
	}
	bodies := svc.bodies("/disp")
	if len(bodies) != 1 {
		t.Fatalf("dispatcher's browser got %d pushes", len(bodies))
	}
	var p struct {
		ID          int64
		Title, Link string
		Body        string
	}
	json.Unmarshal(dispBrowser.decrypt(t, bodies[0]), &p)
	if p.Title != "Нове замовлення транспорту" || p.Link != "/admin/transport" || !strings.Contains(p.Body, "Філія А") || p.ID == 0 {
		t.Fatalf("decrypted payload %+v", p)
	}
	if len(svc.bodies("/other")) != 0 {
		t.Fatal("another user's browser received the message")
	}
	// Sent once: a second pass finds nothing to do.
	if n, _ := a.pushPass(context.Background()); n != 0 || len(svc.bodies("/disp")) != 1 {
		t.Fatalf("a delivered notification was pushed again (%d)", n)
	}
}

func TestDispatcherSkipsStaleRowsInactiveUsersAndForgetsGoneBrowsers(t *testing.T) {
	svc := newPushService(t)
	d := newDesksWith(t, pushDeps)
	a := &App{Deps: d.e.depsForTest()}
	br := newBrowser(t)
	d.post(d.a, "POST", "/api/v1/push/subscriptions", br.subscription(svc.srv.URL+"/a"))
	var uid int64
	d.e.st.R.QueryRow("SELECT id FROM users WHERE login = 'desk_a'").Scan(&uid)
	now := d.e.now
	ins := func(title string, at time.Time) {
		d.e.st.W.Exec("INSERT INTO notifications (user_id, kind, title, created_at) VALUES (?, 'x', ?, ?)", uid, title, at.Unix())
	}
	ins("history", now.Add(-time.Hour))
	if n, _ := a.pushPass(context.Background()); n != 0 || len(svc.bodies("/a")) != 0 {
		t.Fatalf("a stale row was pushed (%d)", n)
	}
	if c := count(d.e, "SELECT COUNT(*) FROM notifications WHERE pushed_at = 0"); c != 0 {
		t.Fatalf("a stale row must be retired, %d left", c)
	}
	// Inactive user: nothing sent.
	d.e.st.W.Exec("UPDATE users SET active = 0 WHERE id = ?", uid)
	ins("for nobody", now)
	a.pushPass(context.Background())
	if len(svc.bodies("/a")) != 0 {
		t.Fatal("pushed to a deactivated user")
	}
	d.e.st.W.Exec("UPDATE users SET active = 1 WHERE id = ?", uid)
	// 410 Gone removes the subscription; a 500 keeps it.
	svc.status["/a"] = 500
	ins("first", now)
	a.pushPass(context.Background())
	if d.ownedSubscriptions() != 1 {
		t.Fatal("a temporary failure must keep the subscription")
	}
	svc.status["/a"] = 410
	ins("second", now)
	a.pushPass(context.Background())
	if d.ownedSubscriptions() != 0 {
		t.Fatal("a gone subscription must be forgotten")
	}
}

func TestSigningOutDropsNothingByItselfButTheClientDeletesFirst(t *testing.T) {
	// The server keeps the subscription until the client deletes it (the page does that before logging out); this
	// documents the contract: DELETE is allowed for the signed-in owner only and is idempotent.
	d := newDesksWith(t, pushDeps)
	br := newBrowser(t)
	ep := "https://fcm.googleapis.com/fcm/send/xyz"
	d.post(d.a, "POST", "/api/v1/push/subscriptions", br.subscription(ep))
	for i := 0; i < 2; i++ {
		if w := d.e.do("DELETE", "/api/v1/push/subscriptions?endpoint="+url.QueryEscape(ep), "", nil, d.a); w.Code != 200 {
			t.Fatalf("delete %d: %d", i, w.Code)
		}
	}
	if d.ownedSubscriptions() != 0 {
		t.Fatal("not deleted")
	}
}
