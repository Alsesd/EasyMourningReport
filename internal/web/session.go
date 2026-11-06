package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

const (
	cookieName    = "session"
	deviceCookie  = "device"
	sessionMaxAge = 7 * 24 * 3600
	tokenBytes    = 32
)

// Session is the per-request session. The cookie carries a random token (HMAC-signed); the server looks the
// token up in user_sessions, so logging out, changing a password or disabling an account really ends it.
type Session struct {
	UID      int64
	Token    string // the raw token of the current session ("" when signed out)
	Device   string // the raw device token to store in the browser ("" = leave the cookie as it is)
	modified bool
	hadData  bool
}

// Start marks the session as signed in with a token that was just stored; the cookie is written with the response.
func (s *Session) Start(uid int64, token, device string) {
	s.UID, s.Token, s.Device, s.modified = uid, token, device, true
}

// Clear signs the session out; the cookie is removed with the response.
func (s *Session) Clear() { s.UID, s.Token, s.Device, s.modified = 0, "", "", true }

type sessionKey struct{}

func SessionFrom(r *http.Request) *Session {
	s, _ := r.Context().Value(sessionKey{}).(*Session)
	if s == nil {
		return &Session{}
	}
	return s
}

// Signer signs and verifies the cookie value: token "." hex(HMAC-SHA256(token)).
type Signer struct {
	Secret []byte
}

func (s Signer) mac(msg string) string {
	h := hmac.New(sha256.New, s.Secret)
	h.Write([]byte(msg))
	return hex.EncodeToString(h.Sum(nil))
}

func (s Signer) Sign(token string) string { return token + "." + s.mac(token) }

// Verify returns the token when the signature is right and the token has the expected shape.
func (s Signer) Verify(value string) (string, bool) {
	i := strings.LastIndex(value, ".")
	if i < 0 {
		return "", false
	}
	token, sig := value[:i], value[i+1:]
	if !hmac.Equal([]byte(sig), []byte(s.mac(token))) || !validToken(token) {
		return "", false
	}
	return token, true
}

func validToken(t string) bool {
	b, err := base64.RawURLEncoding.DecodeString(t)
	return err == nil && len(b) == tokenBytes
}

// SessionHooks connect the cookie middleware to the session store.
type SessionHooks struct {
	// Lookup resolves a verified token to a user id (false: unknown, expired or revoked).
	Lookup func(ctx context.Context, token string) (int64, bool)
	// Device checks the device token the browser presented. ok=false: the cookie was copied or replayed, the
	// session is revoked and the request is dropped without an answer. fresh is a replacement to store.
	Device func(ctx context.Context, token, presented string) (ok bool, fresh string)
}

// drop ends the connection without writing a single byte. A request with a session cookie that was not
// issued to this browser gets no answer at all, so a probe learns nothing, not even that the route exists.
func drop(w http.ResponseWriter) {
	if conn, _, err := http.NewResponseController(w).Hijack(); err == nil {
		_ = conn.Close()
		return
	}
	panic(http.ErrAbortHandler) // the server closes the connection and logs nothing
}

// sessionMiddleware loads the session from the cookie and applies cookie changes to the
// response just before its headers are written.
func sessionMiddleware(sg Signer, secure func(*http.Request) bool, hooks SessionHooks, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := &Session{}
		fresh := ""
		if c, err := r.Cookie(cookieName); err == nil {
			token, ok := sg.Verify(c.Value)
			if !ok {
				if c.Value != "null" && c.Value != "" {
					if isAPIPath(r.URL.Path) {
						drop(w) // a value this server never signed
						return
					}
					// A page load must still work (another app on this host name, or a changed SECRET_KEY, can
					// leave such a cookie behind): serve it signed out and expire the stale cookies.
					s.modified, s.hadData = true, true
				}
			} else if uid, ok := hooks.Lookup(r.Context(), token); ok {
				presented := ""
				if d, err := r.Cookie(deviceCookie); err == nil {
					presented, _ = sg.Verify(d.Value)
				}
				good, rotated := hooks.Device(r.Context(), token, presented)
				if !good {
					drop(w)
					return
				}
				s.UID, s.Token, s.hadData, fresh = uid, token, true, rotated
			}
		}
		sw := &sessionWriter{ResponseWriter: w, s: s, sg: sg, secure: secure(r), fresh: fresh}
		next.ServeHTTP(sw, r.WithContext(context.WithValue(r.Context(), sessionKey{}, s)))
	})
}

type sessionWriter struct {
	http.ResponseWriter
	s       *Session
	sg      Signer
	secure  bool
	fresh   string // rotated device token
	started bool
}

func (w *sessionWriter) cookie(name, value string, maxAge int) string {
	c := &http.Cookie{Name: name, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: w.secure}
	if maxAge < 0 {
		c.Value, c.MaxAge, c.Expires = "null", -1, time.Unix(0, 0)
	} else {
		c.Value, c.MaxAge = w.sg.Sign(value), maxAge
	}
	return c.String()
}

func (w *sessionWriter) WriteHeader(code int) {
	if !w.started {
		w.started = true
		h := w.Header()
		switch {
		case w.s.modified && w.s.UID != 0 && w.s.Token != "":
			h.Add("Set-Cookie", w.cookie(cookieName, w.s.Token, sessionMaxAge))
			if w.s.Device != "" {
				h.Add("Set-Cookie", w.cookie(deviceCookie, w.s.Device, sessionMaxAge))
			}
		case w.s.modified && w.s.hadData:
			h.Add("Set-Cookie", w.cookie(cookieName, "", -1))
			h.Add("Set-Cookie", w.cookie(deviceCookie, "", -1))
		case w.fresh != "" && !w.s.modified:
			h.Add("Set-Cookie", w.cookie(deviceCookie, w.fresh, sessionMaxAge))
		}
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *sessionWriter) Write(b []byte) (int, error) {
	if !w.started {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

func (w *sessionWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
