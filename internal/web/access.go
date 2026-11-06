package web

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Cloudflare Access (optional): when CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set, every request that came
// through the tunnel must carry a valid Cf-Access-Jwt-Assertion, so only people Cloudflare Access let in (email
// one-time PIN, identity provider) reach the app. Local access (loopback without Cf-Connecting-IP) is untouched,
// so a wrong setting can always be fixed on the machine itself.

const accessHeader = "Cf-Access-Jwt-Assertion"

// AccessConfig turns the check on. JWKSURL and Client are for tests; the defaults are Cloudflare's.
type AccessConfig struct {
	TeamDomain string // "myteam.cloudflareaccess.com"
	Audience   string // the application's AUD tag
	JWKSURL    string
	Client     *http.Client
	Now        func() time.Time

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	lastFetch time.Time
}

func (c *AccessConfig) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c *AccessConfig) issuer() string { return "https://" + c.TeamDomain }

func (c *AccessConfig) certsURL() string {
	if c.JWKSURL != "" {
		return c.JWKSURL
	}
	return c.issuer() + "/cdn-cgi/access/certs"
}

// viaTunnel: the request came from the local cloudflared. The edge sets Cf-Connecting-IP itself and
// overwrites whatever a client sends, so a browser on this machine cannot pass as tunnel traffic by accident
// and a remote client cannot pass as local.
func viaTunnel(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback() && r.Header.Get("Cf-Connecting-IP") != ""
}

// accessGuard sits outside the session layer: tunnel traffic without a valid token never reaches sessions.
func accessGuard(c *AccessConfig, next http.Handler) http.Handler {
	if c == nil || c.TeamDomain == "" || c.Audience == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if viaTunnel(r) {
			if err := c.verify(r.Context(), r.Header.Get(accessHeader)); err != nil {
				log.Printf("cloudflare access: request refused: %v", err)
				plain(w, http.StatusForbidden, "Доступ заборонено: потрібен вхід через Cloudflare Access.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (c *AccessConfig) refresh(ctx context.Context, force bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !force && c.keys != nil {
		return nil
	}
	if c.keys != nil && c.now().Sub(c.lastFetch) < time.Minute {
		return nil // rate limit: an attacker's unknown kid must not make us hammer Cloudflare
	}
	c.lastFetch = c.now()
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.certsURL(), nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("certs answered %d", resp.StatusCode)
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&set); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, e1 := base64.RawURLEncoding.DecodeString(k.N)
		e, e2 := base64.RawURLEncoding.DecodeString(k.E)
		if e1 != nil || e2 != nil || len(n) < 256 || len(e) == 0 || len(e) > 4 {
			continue
		}
		exp := 0
		for _, b := range e {
			exp = exp<<8 | int(b)
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exp}
	}
	if len(keys) == 0 {
		return errors.New("certs held no usable key") // keep the last good set
	}
	c.keys = keys
	return nil
}

func (c *AccessConfig) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if err := c.refresh(ctx, false); err != nil {
		c.mu.Lock()
		have := c.keys != nil
		c.mu.Unlock()
		if !have {
			return nil, err
		}
	}
	c.mu.Lock()
	k := c.keys[kid]
	c.mu.Unlock()
	if k != nil {
		return k, nil
	}
	_ = c.refresh(ctx, true) // unknown kid: Cloudflare may have rotated its keys
	c.mu.Lock()
	k = c.keys[kid]
	c.mu.Unlock()
	if k == nil {
		return nil, errors.New("unknown signing key")
	}
	return k, nil
}

type audList []string

func (a *audList) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		*a = audList{one}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return err
	}
	*a = many
	return nil
}

const accessLeeway = 60 * time.Second

func (c *AccessConfig) verify(ctx context.Context, token string) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return errors.New("no token")
	}
	var head struct{ Alg, Kid string }
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(hb, &head) != nil || head.Alg != "RS256" {
		return errors.New("unsupported token algorithm")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return errors.New("bad signature encoding")
	}
	key, err := c.key(ctx, head.Kid)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig) != nil {
		return errors.New("bad signature")
	}
	pb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return errors.New("bad payload encoding")
	}
	var claims struct {
		Iss string   `json:"iss"`
		Aud audList  `json:"aud"`
		Exp float64  `json:"exp"`
		Nbf *float64 `json:"nbf"`
	}
	if json.Unmarshal(pb, &claims) != nil {
		return errors.New("bad payload")
	}
	now := c.now()
	if claims.Iss != c.issuer() {
		return fmt.Errorf("wrong issuer %q", claims.Iss)
	}
	okAud := false
	for _, a := range claims.Aud {
		okAud = okAud || a == c.Audience
	}
	if !okAud {
		return errors.New("token is for another application (check CF_ACCESS_AUD)")
	}
	if claims.Exp == 0 || now.After(time.Unix(int64(claims.Exp), 0).Add(accessLeeway)) {
		return errors.New("token expired")
	}
	if claims.Nbf != nil && now.Add(accessLeeway).Before(time.Unix(int64(*claims.Nbf), 0)) {
		return errors.New("token not valid yet")
	}
	return nil
}
