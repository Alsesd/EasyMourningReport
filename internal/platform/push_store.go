package platform

import (
	"context"
	"database/sql"
	"time"
)

// maxPushPerUser bounds how many browsers one account can register.
const maxPushPerUser = 10

// SavePushSubscription registers a browser for the user. The endpoint is unique: signing in on a device that
// another person used before moves its subscription to the new user, so nobody receives someone else's messages.
func SavePushSubscription(tx *sql.Tx, userID int64, sub PushSubscription, now time.Time) error {
	if _, err := tx.Exec(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
			created_at = excluded.created_at`, userID, sub.Endpoint, sub.P256dh, sub.Auth, now.Unix()); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
		(SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?)`, userID, userID, maxPushPerUser)
	return err
}

// DeletePushSubscription removes the user's own subscription (someone else's endpoint changes nothing).
func DeletePushSubscription(tx *sql.Tx, userID int64, endpoint string) error {
	_, err := tx.Exec("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", userID, endpoint)
	return err
}

// ForgetPushEndpoint removes a subscription the push service reported gone.
func ForgetPushEndpoint(tx *sql.Tx, endpoint string) error {
	_, err := tx.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint)
	return err
}

// PushTargets are the browsers of an active user.
func PushTargets(ctx context.Context, q Querier, userID int64) ([]PushSubscription, error) {
	rows, err := q.QueryContext(ctx, `SELECT s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
		JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND u.active != 0 ORDER BY s.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var s PushSubscription
		if err := rows.Scan(&s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
