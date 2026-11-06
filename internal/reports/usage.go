package reports

import (
	"context"

	"legkyi/internal/core"
)

// UsagePerOrganisation counts submitted and draft reports per store (organisation).
func UsagePerOrganisation(ctx context.Context, q core.Querier) (map[int64]int, error) {
	rows, err := q.QueryContext(ctx, "SELECT store_id, COUNT(id) FROM reports GROUP BY store_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}
