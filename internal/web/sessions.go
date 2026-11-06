package web

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"time"
)

const (
	// deviceRotateEvery: how often the device token is replaced while the browser keeps using the app.
	deviceRotateEvery = 10 * time.Minute
	// deviceGrace: how long the previous device token still works after a rotation (parallel requests,
	// a response that never arrived).
	deviceGrace = 30 * time.Minute
	// deviceResync: a request that still carries the previous token this long after the rotation did not
	// merely race it: the new cookie never arrived, so a new one is issued.
	deviceResync = time.Minute
)

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// startSession stores a new session for the user (and prunes expired ones) and returns the raw session token
// and the raw device token that binds it to this browser.
// sessionMeta is what the administrators' session list shows about where a session was started.
type sessionMeta struct{ IP, UserAgent string }

func (a *App) metaOf(r *http.Request) sessionMeta {
	ua := r.UserAgent()
	if len(ua) > 300 {
		ua = ua[:300]
	}
	return sessionMeta{IP: a.Trusted.ClientIP(r), UserAgent: ua}
}

func startSession(tx *sql.Tx, uid int64, now time.Time, meta sessionMeta) (token, device string, err error) {
	if token, err = newToken(); err != nil {
		return "", "", err
	}
	if device, err = newToken(); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec("DELETE FROM user_sessions WHERE expires_at < ?", now.Unix()); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec("DELETE FROM session_devices WHERE token_hash NOT IN (SELECT token_hash FROM user_sessions)"); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec("INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
		hashToken(token), uid, now.Unix(), now.Add(sessionMaxAge*time.Second).Unix()); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec("INSERT INTO session_devices (token_hash, device_hash, prev_hash, rotated_at, ip, user_agent, last_seen) VALUES (?, ?, '', ?, ?, ?, ?)",
		hashToken(token), hashToken(device), now.Unix(), meta.IP, meta.UserAgent, now.Unix()); err != nil {
		return "", "", err
	}
	return token, device, nil
}

// endSession deletes one session.
func endSession(tx *sql.Tx, token string) error {
	h := hashToken(token)
	if _, err := tx.Exec("DELETE FROM session_devices WHERE token_hash = ?", h); err != nil {
		return err
	}
	_, err := tx.Exec("DELETE FROM user_sessions WHERE token_hash = ?", h)
	return err
}

// endUserSessions deletes every session of the user (password reset, account disabled or deleted).
func endUserSessions(tx *sql.Tx, uid int64) error {
	if _, err := tx.Exec("DELETE FROM session_devices WHERE token_hash IN (SELECT token_hash FROM user_sessions WHERE user_id = ?)", uid); err != nil {
		return err
	}
	_, err := tx.Exec("DELETE FROM user_sessions WHERE user_id = ?", uid)
	return err
}

// sessionUser resolves a token to its user while the session exists, has not expired and is bound to a
// device (sessions from before device binding existed are not valid: their users sign in once more).
func (a *App) sessionUser(ctx context.Context, token string) (int64, bool) {
	var uid int64
	err := a.Store.R.QueryRowContext(ctx, `SELECT s.user_id FROM user_sessions s
		JOIN session_devices d ON d.token_hash = s.token_hash
		WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(token), a.now().Unix()).Scan(&uid)
	return uid, err == nil && uid > 0
}

// checkDevice compares the device token the browser presented with the session's. fresh is a new token the
// browser must store (rotation); ok=false means the request must be ignored and the session is gone.
func (a *App) checkDevice(ctx context.Context, token, presented string) (ok bool, fresh string) {
	if presented == "" {
		a.revokeSession(ctx, token)
		return false, ""
	}
	th := hashToken(token)
	var dev, prev string
	var rotated int64
	if err := a.Store.R.QueryRowContext(ctx, "SELECT device_hash, prev_hash, rotated_at FROM session_devices WHERE token_hash = ?", th).
		Scan(&dev, &prev, &rotated); err != nil {
		return false, "" // the session vanished between the two lookups
	}
	ph := hashToken(presented)
	now := a.now()
	age := now.Sub(time.Unix(rotated, 0))
	rotate := false
	switch {
	case ph == dev:
		rotate = age >= deviceRotateEvery
	case prev != "" && ph == prev && age <= deviceGrace:
		rotate = age >= deviceResync
	default:
		a.revokeSession(ctx, token)
		return false, ""
	}
	if !rotate {
		return true, ""
	}
	next, err := newToken()
	if err != nil {
		return true, ""
	}
	// Compare-and-set on rotated_at so two parallel requests do not both rotate.
	var swapped bool
	_ = a.write(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec("UPDATE session_devices SET device_hash = ?, prev_hash = ?, rotated_at = ?, last_seen = ? WHERE token_hash = ? AND rotated_at = ?",
			hashToken(next), ph, now.Unix(), now.Unix(), th, rotated)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		swapped = n == 1
		return nil
	})
	if !swapped {
		return true, ""
	}
	return true, next
}

// revokeSession ends a session whose device token did not match: the cookie was copied or replayed.
func (a *App) revokeSession(ctx context.Context, token string) {
	_ = a.write(ctx, func(tx *sql.Tx) error { return endSession(tx, token) })
}
