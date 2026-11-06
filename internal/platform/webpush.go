package platform

import (
	"bytes"
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
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Web Push (RFC 8030) with message encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292), standard library only.
// It lets the server reach a device while the app is closed: the browser's push service wakes the service worker.

var b64 = base64.RawURLEncoding

// LoadVAPIDKey returns the application server key pair. VAPID_PRIVATE_KEY (base64url of the 32-byte scalar) wins;
// otherwise <data>/vapid.key is read, or created (0600, never overwritten) when absent. It is a file and not a
// database row on purpose: a backup must never hold a key that can send as this server. A new key would silently
// invalidate every subscription, so the file is only ever created.
func LoadVAPIDKey(getenv func(string) string, dataDir string) (*ecdsa.PrivateKey, error) {
	if v := strings.TrimSpace(getenv("VAPID_PRIVATE_KEY")); v != "" {
		return parseVAPID(v)
	}
	path := filepath.Join(dataDir, "vapid.key")
	if data, err := os.ReadFile(path); err == nil {
		return parseVAPID(strings.TrimSpace(string(data)))
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	d, err := key.Bytes()
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) { // another start created it first
		data, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil, rerr
		}
		return parseVAPID(strings.TrimSpace(string(data)))
	}
	if err != nil {
		return nil, err
	}
	_, werr := f.WriteString(b64.EncodeToString(d))
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return nil, werr
	}
	return key, nil
}

func parseVAPID(s string) (*ecdsa.PrivateKey, error) {
	raw, err := b64.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("VAPID private key: %w", err)
	}
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	if err != nil {
		return nil, fmt.Errorf("VAPID private key: %w", err)
	}
	return key, nil
}

// VAPIDPublicKey is the key the browser subscribes against (uncompressed point, base64url).
func VAPIDPublicKey(key *ecdsa.PrivateKey) (string, error) {
	pub, err := key.PublicKey.Bytes()
	if err != nil {
		return "", err
	}
	return b64.EncodeToString(pub), nil
}

// vapidAuthorization builds the Authorization header: an ES256 JWT for the push service's origin plus the public key.
// The signature is the raw r||s (64 bytes), not ASN.1.
func vapidAuthorization(key *ecdsa.PrivateKey, endpoint *url.URL, subject string, now time.Time) (string, error) {
	hdr := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{
		"aud": endpoint.Scheme + "://" + endpoint.Host,
		"exp": now.Add(12 * time.Hour).Unix(),
		"sub": subject,
	})
	input := hdr + "." + b64.EncodeToString(claims)
	sum := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	pub, err := VAPIDPublicKey(key)
	if err != nil {
		return "", err
	}
	return "vapid t=" + input + "." + b64.EncodeToString(sig) + ", k=" + pub, nil
}

// EncryptPush encrypts plaintext for one subscription (RFC 8291 section 3.4). salt (16 bytes) and the sender's
// ephemeral key are parameters so the RFC's worked example can be checked; Send passes fresh random ones.
func EncryptPush(plaintext, uaPublic, authSecret, salt []byte, sender *ecdh.PrivateKey) ([]byte, error) {
	if len(plaintext) > 3993 { // one record of 4096 minus header (86) and tag (16) and the delimiter
		return nil, errors.New("push payload too large")
	}
	curve := ecdh.P256()
	ua, err := curve.NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("subscription key: %w", err)
	}
	shared, err := sender.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPublic := sender.PublicKey().Bytes()
	prkKey, err := hkdf.Extract(sha256.New, shared, authSecret)
	if err != nil {
		return nil, err
	}
	keyInfo := append(append([]byte("WebPush: info\x00"), uaPublic...), asPublic...)
	ikm, err := hkdf.Expand(sha256.New, prkKey, string(keyInfo), 32)
	if err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, append(append([]byte{}, plaintext...), 0x02), nil) // 0x02: last record
	var out bytes.Buffer
	out.Write(salt)
	_ = binary.Write(&out, binary.BigEndian, uint32(4096))
	out.WriteByte(byte(len(asPublic)))
	out.Write(asPublic)
	out.Write(sealed)
	return out.Bytes(), nil
}

// PushSubscription is what the browser gives the page (PushSubscription.toJSON) and the server stores.
type PushSubscription struct {
	Endpoint, P256dh, Auth string
}

// ErrSubscriptionGone: the push service says the subscription no longer exists (404/410); delete it.
var ErrSubscriptionGone = errors.New("push subscription is gone")

// PushSender delivers encrypted messages. Allow vets an endpoint before anything is sent to it.
type PushSender struct {
	Key     *ecdsa.PrivateKey
	Subject string
	Client  *http.Client
	Allow   func(*url.URL) error
	Now     func() time.Time
}

// Send encrypts payload for sub and posts it. ErrSubscriptionGone tells the caller to forget the subscription.
func (s *PushSender) Send(ctx context.Context, sub PushSubscription, payload []byte) error {
	ep, err := url.Parse(sub.Endpoint)
	if err != nil {
		return err
	}
	allow := s.Allow
	if allow == nil {
		allow = AllowedPushEndpoint
	}
	if err := allow(ep); err != nil {
		return err
	}
	uaPub, err := b64.DecodeString(sub.P256dh)
	if err != nil {
		return fmt.Errorf("p256dh: %w", err)
	}
	auth, err := b64.DecodeString(sub.Auth)
	if err != nil {
		return fmt.Errorf("auth: %w", err)
	}
	eph, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	body, err := EncryptPush(payload, uaPub, auth, salt, eph)
	if err != nil {
		return err
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	authz, err := vapidAuthorization(s.Key, ep, s.Subject, now)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", "86400")
	req.Header.Set("Urgency", "normal")
	req.Header.Set("Authorization", authz)
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrSubscriptionGone
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return fmt.Errorf("push service answered %d", resp.StatusCode)
	}
	return nil
}

// pushHosts are the push services browsers use: Google (Chrome, Edge on Android, Samsung), Mozilla, Apple, Windows.
var pushHostSuffixes = []string{".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"}
var pushHostsExact = []string{"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}

// AllowedPushEndpoint is the SSRF guard: the server will POST to an address the client supplied, so it must be https
// on port 443 at a known push service, never an IP address or an internal name.
func AllowedPushEndpoint(u *url.URL) error {
	if u.Scheme != "https" || u.User != nil {
		return errors.New("push endpoint must be https")
	}
	if p := u.Port(); p != "" && p != "443" {
		return errors.New("push endpoint port not allowed")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || net.ParseIP(host) != nil {
		return errors.New("push endpoint host not allowed")
	}
	for _, h := range pushHostsExact {
		if host == h {
			return nil
		}
	}
	for _, s := range pushHostSuffixes {
		if strings.HasSuffix(host, s) {
			return nil
		}
	}
	return errors.New("push endpoint host not allowed")
}

// DecodePushKey reads a base64url value the browser sent (padding tolerated).
func DecodePushKey(s string) ([]byte, error) {
	return b64.DecodeString(strings.TrimRight(s, "="))
}
