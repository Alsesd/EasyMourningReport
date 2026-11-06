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
	sessionMaxAge = 7 * 24 * 3600
	tokenBytes    = 32
)

// Session is the per-request session. The cookie carries a random token (HMAC-signed); the server looks the
// token up in user_sessions, so logging out, changing a password or disabling an account really ends it.
type Session struct {
	UID      int64
	Token    string // the raw token of the current session ("" when signed out)
	modified bool
	hadData  bool
}

// Start marks the session as signed in with a token that was just stored; the cookie is written with the response.
func (s *Session) Start(uid int64, token string) { s.UID, s.Token, s.modified = uid, token, true }

// Clear signs the session out; the cookie is removed with the response.
func (s *Session) Clear() { s.UID, s.Token, s.modified = 0, "", true }

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

// UserLookup resolves a verified token to a user id (false: unknown, expired or revoked).
type UserLookup func(ctx context.Context, token string) (int64, bool)

// sessionMiddleware loads the session from the cookie and applies cookie changes to the
// response just before its headers are written.
func sessionMiddleware(sg Signer, secure func(*http.Request) bool, lookup UserLookup, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := &Session{}
		if c, err := r.Cookie(cookieName); err == nil {
			if token, ok := sg.Verify(c.Value); ok {
				if uid, ok := lookup(r.Context(), token); ok {
					s.UID, s.Token, s.hadData = uid, token, true
				}
			}
		}
		sw := &sessionWriter{ResponseWriter: w, s: s, sg: sg, secure: secure(r)}
		next.ServeHTTP(sw, r.WithContext(context.WithValue(r.Context(), sessionKey{}, s)))
	})
}

type sessionWriter struct {
	http.ResponseWriter
	s       *Session
	sg      Signer
	secure  bool
	started bool
}

func (w *sessionWriter) WriteHeader(code int) {
	if !w.started {
		w.started = true
		h := w.Header()
		if w.s.modified {
			c := &http.Cookie{Name: cookieName, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: w.secure}
			if w.s.UID != 0 && w.s.Token != "" {
				c.Value, c.MaxAge = w.sg.Sign(w.s.Token), sessionMaxAge
				h.Add("Set-Cookie", c.String())
			} else if w.s.hadData {
				c.Value, c.MaxAge, c.Expires = "null", -1, time.Unix(0, 0)
				h.Add("Set-Cookie", c.String())
			}
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
