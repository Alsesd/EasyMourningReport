package web

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"time"
)

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// startSession stores a new session for the user (and prunes expired ones) and returns the raw token.
func newToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func startSession(tx *sql.Tx, uid int64, now time.Time) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec("DELETE FROM user_sessions WHERE expires_at < ?", now.Unix()); err != nil {
		return "", err
	}
	if _, err := tx.Exec("INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
		hashToken(token), uid, now.Unix(), now.Add(sessionMaxAge*time.Second).Unix()); err != nil {
		return "", err
	}
	return token, nil
}

// endSession deletes one session.
func endSession(tx *sql.Tx, token string) error {
	_, err := tx.Exec("DELETE FROM user_sessions WHERE token_hash = ?", hashToken(token))
	return err
}

// endUserSessions deletes every session of the user (password reset, account disabled or deleted).
func endUserSessions(tx *sql.Tx, uid int64) error {
	_, err := tx.Exec("DELETE FROM user_sessions WHERE user_id = ?", uid)
	return err
}

// sessionUser resolves a token to its user while the session exists and has not expired.
func (a *App) sessionUser(ctx context.Context, token string) (int64, bool) {
	var uid int64
	err := a.Store.R.QueryRowContext(ctx, "SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > ?",
		hashToken(token), a.now().Unix()).Scan(&uid)
	return uid, err == nil && uid > 0
}
