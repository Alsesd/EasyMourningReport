package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	cookieName    = "session"
	sessionMaxAge = 7 * 24 * 3600
)

// Session is the per-request session. Like Starlette's SessionMiddleware (the locked version),
// a cookie is written only when the session was modified: login sets it, logout clears it.
type Session struct {
	UID      int64
	modified bool
	hadData  bool
}

func (s *Session) Set(uid int64) { s.UID, s.modified = uid, true }
func (s *Session) Clear()        { s.UID, s.modified = 0, true }

type sessionKey struct{}

func SessionFrom(r *http.Request) *Session {
	s, _ := r.Context().Value(sessionKey{}).(*Session)
	if s == nil {
		return &Session{}
	}
	return s
}

// Signer signs and verifies the cookie value: b64url(json) "." unix-ts "." hex(HMAC-SHA256).
// It is not the itsdangerous format: existing cookies simply fail and the user signs in again.
type Signer struct {
	Secret []byte
	Now    func() time.Time
}

func (s Signer) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s Signer) mac(msg string) string {
	h := hmac.New(sha256.New, s.Secret)
	h.Write([]byte(msg))
	return hex.EncodeToString(h.Sum(nil))
}

func (s Signer) Sign(uid int64) string {
	payload, _ := json.Marshal(map[string]int64{"uid": uid})
	msg := base64.RawURLEncoding.EncodeToString(payload) + "." + strconv.FormatInt(s.now().Unix(), 10)
	return msg + "." + s.mac(msg)
}

// Verify returns the user id, or ok=false for a bad, tampered, expired or foreign cookie.
func (s Signer) Verify(value string) (int64, bool) {
	i := strings.LastIndex(value, ".")
	if i < 0 {
		return 0, false
	}
	msg, sig := value[:i], value[i+1:]
	if !hmac.Equal([]byte(sig), []byte(s.mac(msg))) {
		return 0, false
	}
	parts := strings.Split(msg, ".")
	if len(parts) != 2 {
		return 0, false
	}
	ts, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || s.now().Unix()-ts > sessionMaxAge || ts-s.now().Unix() > 60 {
		return 0, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, false
	}
	var data map[string]int64
	if json.Unmarshal(raw, &data) != nil || data["uid"] <= 0 {
		return 0, false
	}
	return data["uid"], true
}

// sessionMiddleware loads the session from the cookie and applies cookie changes to the
// response just before its headers are written.
func sessionMiddleware(sg Signer, secure bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := &Session{}
		if c, err := r.Cookie(cookieName); err == nil {
			if uid, ok := sg.Verify(c.Value); ok {
				s.UID, s.hadData = uid, true
			}
		}
		sw := &sessionWriter{ResponseWriter: w, s: s, sg: sg, secure: secure}
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
			if w.s.UID != 0 {
				c.Value, c.MaxAge = w.sg.Sign(w.s.UID), sessionMaxAge
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
