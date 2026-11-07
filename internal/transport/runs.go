package transport

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"legkyi/internal/core"
)

// Goods-run statuses: planned -> in_progress -> done, or cancelled from planned/in_progress.
const (
	RunPlanned    = "planned"
	RunInProgress = "in_progress"
	RunDone       = "done"
	RunCancelled  = "cancelled"
)

// DefaultDeparture is where a goods run starts when the dispatcher does not say otherwise.
const DefaultDeparture = "Склад"

var runNext = map[string][]string{
	RunPlanned:    {RunInProgress, RunCancelled},
	RunInProgress: {RunDone, RunCancelled},
}

// CanSetRun reports whether a run may move from one status to another.
func CanSetRun(from, to string) bool {
	for _, s := range runNext[from] {
		if s == to {
			return true
		}
	}
	return false
}

// RunStop is a point of the route: a desk and the place (by default the desk's name).
type RunStop struct {
	ID               int64
	Position         int
	OrganisationID   int64
	OrganisationName string
	Place            string
	Lines            []CargoLine
}

// Run is a goods-delivery run: one car, a route over several desks and the cargo at each stop.
type Run struct {
	ID                                  int64
	ServiceDate, Time, Departure, Notes string
	CarID                               int64
	CarPlate, Status                    string
	CreatedByID                         int64
	CreatedByName                       string
	CreatedAt, UpdatedAt                int64
	Stops                               []RunStop
}

var ErrRunNotFound = errors.New("goods run not found")

const runColumns = `r.id, r.service_date, r.car_id, r.car_plate, r.time, r.departure, r.notes, r.status,
	COALESCE(r.created_by_id, 0), r.created_by_name, r.created_at, r.updated_at`

// RunFilter narrows ListRuns.
type RunFilter struct {
	From, To       string
	OrganisationID int64 // only runs with a stop of this organisation (0 = all)
	ID             int64
}

// ListRuns returns runs ordered by day and time, with stops and cargo.
func ListRuns(ctx context.Context, q core.Querier, f RunFilter) ([]Run, error) {
	var where []string
	var args []any
	if f.ID != 0 {
		where = append(where, "r.id = ?")
		args = append(args, f.ID)
	}
	if f.From != "" {
		where = append(where, "r.service_date >= ?")
		args = append(args, f.From)
	}
	if f.To != "" {
		where = append(where, "r.service_date <= ?")
		args = append(args, f.To)
	}
	if f.OrganisationID != 0 {
		where = append(where, "EXISTS (SELECT 1 FROM transport_run_stops s WHERE s.run_id = r.id AND s.organisation_id = ?)")
		args = append(args, f.OrganisationID)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := q.QueryContext(ctx, `SELECT `+runColumns+` FROM transport_runs r`+clause+` ORDER BY r.service_date, r.time, r.id`, args...)
	if err != nil {
		return nil, err
	}
	var out []Run
	for rows.Next() {
		var r Run
		if err := rows.Scan(&r.ID, &r.ServiceDate, &r.CarID, &r.CarPlate, &r.Time, &r.Departure, &r.Notes, &r.Status,
			&r.CreatedByID, &r.CreatedByName, &r.CreatedAt, &r.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if len(out) == 0 {
		return out, nil
	}
	ids := make([]int64, len(out))
	pos := map[int64]int{}
	for i, r := range out {
		ids[i] = r.ID
		pos[r.ID] = i
	}
	in, iargs := inClause(ids)
	srows, err := q.QueryContext(ctx, `SELECT s.id, s.run_id, s.position, s.organisation_id, COALESCE(org.name, ''), s.place
		FROM transport_run_stops s LEFT JOIN organisations org ON org.id = s.organisation_id WHERE s.run_id IN `+in+` ORDER BY s.run_id, s.position, s.id`, iargs...)
	if err != nil {
		return nil, err
	}
	stopAt := map[int64][2]int{}
	var stopIDs []int64
	for srows.Next() {
		var st RunStop
		var rid int64
		if err := srows.Scan(&st.ID, &rid, &st.Position, &st.OrganisationID, &st.OrganisationName, &st.Place); err != nil {
			srows.Close()
			return nil, err
		}
		ri := pos[rid]
		stopAt[st.ID] = [2]int{ri, len(out[ri].Stops)}
		out[ri].Stops = append(out[ri].Stops, st)
		stopIDs = append(stopIDs, st.ID)
	}
	if err := srows.Err(); err != nil {
		srows.Close()
		return nil, err
	}
	srows.Close()
	sin, sargs := inClause(stopIDs)
	lines, err := loadCargo(ctx, q, "WHERE c.run_stop_id IN "+sin, sargs...)
	if err != nil {
		return nil, err
	}
	for _, l := range lines {
		p := stopAt[l.RunStopID]
		st := &out[p[0]].Stops[p[1]]
		st.Lines = append(st.Lines, l)
	}
	return out, nil
}

// GetRun returns one run or ErrRunNotFound.
func GetRun(ctx context.Context, q core.Querier, id int64) (Run, error) {
	l, err := ListRuns(ctx, q, RunFilter{ID: id})
	if err != nil {
		return Run{}, err
	}
	if len(l) == 0 {
		return Run{}, ErrRunNotFound
	}
	return l[0], nil
}

// StopInput is one wanted stop of a run with the cargo to leave there.
type StopInput struct {
	OrganisationID int64
	Place          string
	Lines          []Line
}

// RunInput is the content of a run the dispatcher saves.
type RunInput struct {
	ServiceDate, Time, Departure, Notes string
	Car                                 Car
	Stops                               []StopInput
}

// writeStops replaces the stops and their cargo of a run. Deleting a stop deletes its cargo (ON DELETE CASCADE), so
// the quantities placeCargo computes afterwards no longer count this run's earlier lines.
func writeStops(ctx context.Context, tx *sql.Tx, id int64, stops []StopInput) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM transport_run_stops WHERE run_id = ?", id); err != nil {
		return err
	}
	for i, st := range stops {
		res, err := tx.ExecContext(ctx, "INSERT INTO transport_run_stops (run_id, position, organisation_id, place) VALUES (?, ?, ?, ?)", id, i, st.OrganisationID, st.Place)
		if err != nil {
			return err
		}
		sid, _ := res.LastInsertId()
		if err := placeCargo(ctx, tx, st.OrganisationID, 0, sid, st.Lines); err != nil {
			return err
		}
	}
	return nil
}

// CreateRun stores a planned run.
func CreateRun(ctx context.Context, tx *sql.Tx, userID int64, userName string, in RunInput, now time.Time) (int64, error) {
	res, err := tx.ExecContext(ctx, `INSERT INTO transport_runs (service_date, car_id, car_plate, time, departure, notes, status, created_by_id, created_by_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, in.ServiceDate, in.Car.ID, in.Car.Display(), in.Time, in.Departure, in.Notes, RunPlanned, userID, userName, now.Unix(), now.Unix())
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, writeStops(ctx, tx, id, in.Stops)
}

// UpdateRun replaces the content of a planned run.
func UpdateRun(ctx context.Context, tx *sql.Tx, id int64, in RunInput, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE transport_runs SET service_date = ?, car_id = ?, car_plate = ?, time = ?, departure = ?, notes = ?, updated_at = ? WHERE id = ?`,
		in.ServiceDate, in.Car.ID, in.Car.Display(), in.Time, in.Departure, in.Notes, now.Unix(), id); err != nil {
		return err
	}
	return writeStops(ctx, tx, id, in.Stops)
}

// SetRunStatus stores a new status of a run.
func SetRunStatus(ctx context.Context, tx *sql.Tx, id int64, status string, now time.Time) error {
	_, err := tx.ExecContext(ctx, "UPDATE transport_runs SET status = ?, updated_at = ? WHERE id = ?", status, now.Unix(), id)
	return err
}
