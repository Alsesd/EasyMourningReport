package core

import (
	"context"
	"time"
)

// Units of a dashboard figure. The client formats them (money in hryvnias, minutes as "12 хв", percent with a sign),
// so a module never sends preformatted text.
const (
	UnitCount      = "count"
	UnitMoneyCents = "money_cents"
	UnitPercent    = "percent"
	UnitMinutes    = "minutes"
)

// DashTile is one headline figure. Tone "alert" marks a figure that needs someone (a count that should be zero).
type DashTile struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
	Hint  string  `json:"hint"`
	Tone  string  `json:"tone"` // "", "alert"
}

// DashPoint is one bar of a series. Partial marks a period that is not over yet (the current month).
type DashPoint struct {
	Label   string  `json:"label"`
	Value   float64 `json:"value"`
	Partial bool    `json:"partial"`
}

// DashSeries is bars over a sequence (months, days).
type DashSeries struct {
	Title  string      `json:"title"`
	Unit   string      `json:"unit"`
	Note   string      `json:"note"`
	Points []DashPoint `json:"points"`
}

// DashRow is one line of a ranked list.
type DashRow struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
	Hint  string  `json:"hint"`
}

// DashList is a list ranked by value, largest first.
type DashList struct {
	Title string    `json:"title"`
	Unit  string    `json:"unit"`
	Rows  []DashRow `json:"rows"`
}

// DashboardBlock is what one part of a module adds to the management dashboard: tiles, bar series, ranked lists.
type DashboardBlock struct {
	Key         string       `json:"key"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Tiles       []DashTile   `json:"tiles"`
	Series      []DashSeries `json:"series"`
	Lists       []DashList   `json:"lists"`
}

// DashboardFunc returns a module's blocks for the management dashboard, which is view-only: it reads, never changes.
// period is the selected month YYYY-MM; now is the current moment in the configured zone (for "present" figures).
type DashboardFunc func(ctx context.Context, q Querier, period string, now time.Time) ([]DashboardBlock, error)

// Normalised makes every list of the block a non-nil slice, so the JSON carries [] and never null.
func (b DashboardBlock) Normalised() DashboardBlock {
	if b.Tiles == nil {
		b.Tiles = []DashTile{}
	}
	if b.Series == nil {
		b.Series = []DashSeries{}
	}
	for i := range b.Series {
		if b.Series[i].Points == nil {
			b.Series[i].Points = []DashPoint{}
		}
	}
	if b.Lists == nil {
		b.Lists = []DashList{}
	}
	for i := range b.Lists {
		if b.Lists[i].Rows == nil {
			b.Lists[i].Rows = []DashRow{}
		}
	}
	return b
}
