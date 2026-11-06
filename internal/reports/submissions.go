package reports

import (
	"context"
	"database/sql"
	"time"

	"legkyi/internal/core"
)

// Signature is one person's mark on a report: when and who.
type Signature struct {
	ByID   int64
	ByName string
	At     time.Time
}

// Signatures of a report: the store employee who submitted it last, and the administrator who locked it last.
type Signatures struct {
	Submitted *Signature // kind "store"
	Locked    *Signature // kind "admin"
}

const (
	KindStore = "store"
	KindAdmin = "admin"
)

// RecordSignature remembers who submitted (kind store) or locked (kind admin) the report. Each kind keeps its own
// row, so an administrator's lock never replaces the employee's signature.
func RecordSignature(ctx context.Context, tx *sql.Tx, reportID, userID int64, userName, kind string, now time.Time) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO report_submissions (report_id, kind, user_id, user_name, at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (report_id, kind) DO UPDATE SET user_id = excluded.user_id, user_name = excluded.user_name, at = excluded.at`,
		reportID, kind, userID, userName, now.Unix())
	return err
}

func (s *Signatures) set(kind string, sig Signature) {
	if kind == KindStore {
		s.Submitted = &sig
	} else if kind == KindAdmin {
		s.Locked = &sig
	}
}

// SignaturesOf returns the signatures of one report (both nil for reports from before they were recorded).
func SignaturesOf(ctx context.Context, q core.Querier, reportID int64) (Signatures, error) {
	rows, err := q.QueryContext(ctx, "SELECT kind, COALESCE(user_id, 0), user_name, at FROM report_submissions WHERE report_id = ?", reportID)
	if err != nil {
		return Signatures{}, err
	}
	defer rows.Close()
	var out Signatures
	for rows.Next() {
		var kind string
		var sig Signature
		var at int64
		if err := rows.Scan(&kind, &sig.ByID, &sig.ByName, &at); err != nil {
			return Signatures{}, err
		}
		sig.At = time.Unix(at, 0)
		out.set(kind, sig)
	}
	return out, rows.Err()
}

// SignaturesForPeriod returns the signatures of all reports of one month by report id.
func SignaturesForPeriod(ctx context.Context, q core.Querier, period string) (map[int64]Signatures, error) {
	rows, err := q.QueryContext(ctx, `SELECT s.report_id, s.kind, COALESCE(s.user_id, 0), s.user_name, s.at
		FROM report_submissions s JOIN reports r ON r.id = s.report_id WHERE r.period = ?`, period)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]Signatures{}
	for rows.Next() {
		var id, at int64
		var kind string
		var sig Signature
		if err := rows.Scan(&id, &kind, &sig.ByID, &sig.ByName, &at); err != nil {
			return nil, err
		}
		sig.At = time.Unix(at, 0)
		cur := out[id]
		cur.set(kind, sig)
		out[id] = cur
	}
	return out, rows.Err()
}
