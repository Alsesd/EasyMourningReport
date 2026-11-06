package reports

import (
	"context"
	"fmt"

	"legkyi/internal/core"
)

// Overview adds the report figures to the administration overview.
func Overview(ctx context.Context, q core.Querier, can func(codes ...string) bool, period string) ([]core.OverviewStat, error) {
	var stats []core.OverviewStat
	one := func(query string, args ...any) (int, error) {
		var n int
		err := q.QueryRowContext(ctx, query, args...).Scan(&n)
		return n, err
	}
	if can(Review) {
		stores, err := one("SELECT COUNT(*) FROM organisations WHERE archived = 0")
		if err != nil {
			return nil, err
		}
		submitted, err := one("SELECT COUNT(*) FROM reports WHERE period = ? AND status = 'submitted'", period)
		if err != nil {
			return nil, err
		}
		drafts, err := one("SELECT COUNT(*) FROM reports WHERE period = ? AND status = 'draft'", period)
		if err != nil {
			return nil, err
		}
		stats = append(stats, core.OverviewStat{Label: "Надіслано звітів за місяць", Value: fmt.Sprintf("%d / %d", submitted, stores),
			Hint: fmt.Sprintf("чернеток: %d", drafts)})
	}
	if can(CatalogManage) {
		active, err := one("SELECT COUNT(*) FROM products WHERE active = 1 AND archived = 0")
		if err != nil {
			return nil, err
		}
		archived, err := one("SELECT COUNT(*) FROM products WHERE archived = 1")
		if err != nil {
			return nil, err
		}
		stats = append(stats, core.OverviewStat{Label: "Активних товарів", Value: fmt.Sprint(active),
			Hint: fmt.Sprintf("в архіві: %d", archived), Section: "products"})
	}
	return stats, nil
}
