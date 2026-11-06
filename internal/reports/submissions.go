package reports

import (
	"context"
	"database/sql"
	"time"

	"legkyi/internal/core"
)

// Submission is the signature of a report: who put it into the submitted (locked) state last.
type Submission struct {
	ByID   int64
	ByName string
	Kind   string // "store": the store employee submitted it; "admin": an administrator locked it
	At     time.Time
}

const (
	KindStore = "store"
	KindAdmin = "admin"
)

// RecordSubmission remembers who submitted (kind store) or locked (kind admin) the report, replacing the previous record.
func RecordSubmission(ctx context.Context, tx *sql.Tx, reportID, userID int64, userName, kind string, now time.Time) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO report_submissions (report_id, user_id, user_name, kind, at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (report_id) DO UPDATE SET user_id = excluded.user_id, user_name = excluded.user_name, kind = excluded.kind, at = excluded.at`,
		reportID, userID, userName, kind, now.Unix())
	return err
}

// SubmissionOf returns the record of one report (nil when none: reports from before the signature existed).
func SubmissionOf(ctx context.Context, q core.Querier, reportID int64) (*Submission, error) {
	var s Submission
	var at int64
	err := q.QueryRowContext(ctx, "SELECT COALESCE(user_id, 0), user_name, kind, at FROM report_submissions WHERE report_id = ?", reportID).
		Scan(&s.ByID, &s.ByName, &s.Kind, &at)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.At = time.Unix(at, 0)
	return &s, nil
}

// SubmissionsForPeriod returns the records of all reports of one month by report id.
func SubmissionsForPeriod(ctx context.Context, q core.Querier, period string) (map[int64]Submission, error) {
	rows, err := q.QueryContext(ctx, `SELECT s.report_id, COALESCE(s.user_id, 0), s.user_name, s.kind, s.at
		FROM report_submissions s JOIN reports r ON r.id = s.report_id WHERE r.period = ?`, period)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]Submission{}
	for rows.Next() {
		var id, at int64
		var s Submission
		if err := rows.Scan(&id, &s.ByID, &s.ByName, &s.Kind, &at); err != nil {
			return nil, err
		}
		s.At = time.Unix(at, 0)
		out[id] = s
	}
	return out, rows.Err()
}
