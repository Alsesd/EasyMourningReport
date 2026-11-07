package platform

import (
	"context"
	"database/sql"
	"time"

	"legkyi/internal/core"
)

// Notification is one in-app message for one user.
type Notification struct {
	ID                int64
	Kind, Title, Body string
	Link              string
	CreatedAt         int64
	Read              bool
}

// Notify writes one notification per user inside the caller's transaction, so a message exists exactly when the
// event that caused it was saved. A non-empty dedupe key makes it idempotent per user (INSERT OR IGNORE).
func Notify(tx *sql.Tx, now time.Time, userIDs []int64, kind, title, body, link, dedupe string) error {
	seen := map[int64]bool{}
	for _, id := range userIDs {
		if id == 0 || seen[id] {
			continue
		}
		seen[id] = true
		if _, err := tx.Exec(`INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, dedupe_key, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, id, kind, title, body, link, dedupe, now.Unix()); err != nil {
			return err
		}
	}
	return nil
}

// Recipients lists the active users who hold at least one of the permission codes (effective permissions, as
// the user would have them when signed in). orgID > 0 limits it to that organisation's users; 0 means everyone,
// and the permission codes themselves keep platform staff and organisation staff apart.
func Recipients(ctx context.Context, q Querier, codesByScope func(scope string) map[string]bool, orgID int64, codes ...string) ([]int64, error) {
	query, args := "SELECT id FROM users WHERE active != 0", []any{}
	if orgID > 0 {
		query, args = query+" AND organisation_id = ?", append(args, orgID)
	}
	rows, err := q.QueryContext(ctx, query+" ORDER BY id", args...)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []int64
	for _, id := range ids {
		u, err := LoadUserByID(ctx, q, id)
		if err != nil {
			return nil, err
		}
		if u == nil {
			continue
		}
		p, err := PrincipalFor(ctx, q, u, codesByScope)
		if err != nil {
			return nil, err
		}
		if p.Can(codes...) {
			out = append(out, id)
		}
	}
	return out, nil
}

// ListNotifications returns the user's newest notifications (newest first) and how many are unread in all.
func ListNotifications(ctx context.Context, q Querier, userID int64, limit int) ([]Notification, int, error) {
	var unread int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at = 0", userID).Scan(&unread); err != nil {
		return nil, 0, err
	}
	rows, err := q.QueryContext(ctx, `SELECT id, kind, title, body, link, created_at, read_at FROM notifications
		WHERE user_id = ? ORDER BY id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		var readAt int64
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Link, &n.CreatedAt, &readAt); err != nil {
			return nil, 0, err
		}
		n.Read = readAt != 0
		out = append(out, n)
	}
	return out, unread, rows.Err()
}

// MarkRead marks the user's own notification read (an id of someone else's changes nothing). id 0 marks all.
func MarkRead(tx *sql.Tx, userID, id int64, now time.Time) error {
	q, args := "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at = 0", []any{now.Unix(), userID}
	if id != 0 {
		q, args = q+" AND id = ?", append(args, id)
	}
	_, err := tx.Exec(q, args...)
	return err
}

// PruneNotifications deletes read notifications older than readKeep and any older than allKeep.
func PruneNotifications(tx *sql.Tx, now time.Time, readKeep, allKeep time.Duration) error {
	_, err := tx.Exec("DELETE FROM notifications WHERE (read_at != 0 AND created_at < ?) OR created_at < ?",
		now.Add(-readKeep).Unix(), now.Add(-allKeep).Unix())
	return err
}

// JoinNames is a small helper for notification texts.
func JoinNames(parts ...string) string { return core.JoinNames(parts...) }
