package reports

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"

	"legkyi/internal/core"
)

// The midnight close (core.Module.DayClose). A day of a daily report is open only until midnight in the business
// zone. When it ends, every store that fills in reports is checked:
//   - a draft day is locked as it is and marked missed (the store had not submitted it);
//   - a store with no report for the day gets an empty locked day, also marked missed;
//   - a submitted day stays as it is.
//
// Missed stays on the day after a reviewer unlocks it and the store submits late, so the record of the late
// report is kept. A day a reviewer unlocked is closed again at the next midnight (not marked missed again).
// Days are processed once each (report_day_close); after a downtime the close catches up, at most maxCatchUp days
// back. The very first run closes nothing: it only records yesterday as processed, because before the close
// existed nobody was told a day ends at midnight. The first real check is the night after installation.

const maxCatchUp = 31

// closeMonthsKeptWhole: a store whose month was submitted as a whole (before daily reports) is not checked.
func closeMonthsKeptWhole(ctx context.Context, tx *sql.Tx, rep *Report) (bool, error) {
	if rep.Status != "submitted" {
		return false, nil
	}
	daily, err := IsDaily(ctx, tx, rep.ID)
	return !daily, err
}

// daysToClose lists the dates that have ended and were not processed yet, oldest first.
func daysToClose(ctx context.Context, tx *sql.Tx, today string) ([]string, error) {
	var last sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT MAX(day) FROM report_day_close").Scan(&last); err != nil {
		return nil, err
	}
	yesterday := shiftDate(today, -1)
	if !last.Valid || last.String == "" {
		_, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO report_day_close (day, closed_at) VALUES (?, 0)", yesterday)
		return nil, err
	}
	from := shiftDate(last.String, 1)
	if earliest := shiftDate(today, -maxCatchUp); from < earliest {
		from = earliest
	}
	var out []string
	for d := from; d <= yesterday; d = shiftDate(d, 1) {
		out = append(out, d)
	}
	return out, nil
}

func shiftDate(day string, delta int) string {
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return day
	}
	return t.AddDate(0, 0, delta).Format("2006-01-02")
}

type reportingStore struct {
	id   int64
	name string
}

// reportingStores are the organisations (not archived) with at least one active user who fills in reports.
func reportingStores(ctx context.Context, tx *sql.Tx, n core.Notifier) ([]reportingStore, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id, name FROM organisations WHERE archived = 0 ORDER BY name")
	if err != nil {
		return nil, err
	}
	var all []reportingStore
	for rows.Next() {
		var s reportingStore
		if err := rows.Scan(&s.id, &s.name); err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []reportingStore
	for _, s := range all {
		ids, err := n.Recipients(s.id, Submit)
		if err != nil {
			return nil, err
		}
		if len(ids) > 0 {
			out = append(out, s)
		}
	}
	return out, nil
}

// missedDay is one store that did not submit one day in time.
type missedDay struct {
	store, day string
}

// closeDay locks one ended day for one store; reports whether the store missed it.
func closeDay(ctx context.Context, tx *sql.Tx, store reportingStore, day string, now time.Time) (bool, error) {
	period := day[:7]
	rep, err := FindReport(ctx, tx, store.id, period)
	if err != nil {
		return false, err
	}
	if rep == nil {
		res, err := tx.ExecContext(ctx, "INSERT INTO reports (store_id, period, status) VALUES (?, ?, 'draft')", store.id, period)
		if err != nil {
			return false, err
		}
		id, _ := res.LastInsertId()
		rep = &Report{ID: id, StoreID: store.id, Period: period, Status: "draft"}
	} else if whole, err := closeMonthsKeptWhole(ctx, tx, rep); err != nil || whole {
		return false, err
	}
	if err := MakeDaily(ctx, tx, rep); err != nil {
		return false, err
	}
	cur, err := LoadDay(ctx, tx, rep.ID, day)
	if err != nil {
		return false, err
	}
	if cur != nil && cur.Status == "submitted" {
		return false, nil
	}
	if err := EnsureDay(ctx, tx, rep.ID, day); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE report_days SET status = 'submitted', missed = 1, auto_locked_at = ? WHERE report_id = ? AND day = ?",
		now.Unix(), rep.ID, day); err != nil {
		return false, err
	}
	_, err = SyncMonthStatus(ctx, tx, rep)
	return true, err
}

// relockOpenDays closes again the past days a reviewer unlocked (a store gets until midnight to correct them).
func relockOpenDays(ctx context.Context, tx *sql.Tx, today string, now time.Time) error {
	rows, err := tx.QueryContext(ctx, `SELECT r.id, r.store_id, r.period, r.status FROM report_days d JOIN reports r ON r.id = d.report_id
		WHERE d.status = 'draft' AND d.day != '' AND d.day < ? GROUP BY r.id`, today)
	if err != nil {
		return err
	}
	var reps []Report
	for rows.Next() {
		var r Report
		if err := rows.Scan(&r.ID, &r.StoreID, &r.Period, &r.Status); err != nil {
			rows.Close()
			return err
		}
		reps = append(reps, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range reps {
		if _, err := tx.ExecContext(ctx, "UPDATE report_days SET status = 'submitted', auto_locked_at = ? WHERE report_id = ? AND status = 'draft' AND day != '' AND day < ?",
			now.Unix(), reps[i].ID, today); err != nil {
			return err
		}
		if _, err := SyncMonthStatus(ctx, tx, &reps[i]); err != nil {
			return err
		}
	}
	return nil
}

// CloseDays is the module's DayClose: it closes every ended day not processed yet and tells the reviewers which
// stores did not submit in time.
func CloseDays(ctx context.Context, tx *sql.Tx, now time.Time, n core.Notifier) error {
	today := now.Format("2006-01-02")
	days, err := daysToClose(ctx, tx, today)
	if err != nil {
		return err
	}
	if len(days) == 0 {
		// Nothing ended since the last close: a restart during the day must not lock what a reviewer reopened.
		return nil
	}
	var missed []missedDay
	{
		stores, err := reportingStores(ctx, tx, n)
		if err != nil {
			return err
		}
		for _, day := range days {
			for _, s := range stores {
				m, err := closeDay(ctx, tx, s, day, now)
				if err != nil {
					return err
				}
				if m {
					missed = append(missed, missedDay{s.name, day})
				}
			}
			if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO report_day_close (day, closed_at) VALUES (?, ?)", day, now.Unix()); err != nil {
				return err
			}
		}
	}
	if err := relockOpenDays(ctx, tx, today, now); err != nil {
		return err
	}
	if len(missed) == 0 {
		return nil
	}
	ids, err := n.Recipients(0, Review)
	if err != nil || len(ids) == 0 {
		return err
	}
	sort.SliceStable(missed, func(i, j int) bool { return missed[i].day < missed[j].day })
	parts := make([]string, 0, len(missed))
	for _, m := range missed {
		parts = append(parts, m.store+" · "+formatDay(m.day))
	}
	last := missed[len(missed)-1].day
	return n.Notify(ids, "report.day_missed", "Звіти не надіслано вчасно", strings.Join(parts, "; "),
		"/admin/reports?period="+last[:7]+"&day="+last, "report.day_missed:"+days[0]+":"+last)
}
