// Package reports is the monthly-reports feature module. This file holds the price-history
// rules (pure functions).
package reports

import (
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
)

// BasePeriod is "since always": the price a product was created with.
const BasePeriod = "0000-00"

// PricePoint is one history record: the month (YYYY-MM, YYYY-MM_N or legacy YYYY-MM#x) from
// which Cents is in force.
type PricePoint struct {
	Period string
	Cents  int64
}

type History []PricePoint

// PeriodMonth returns YYYY-MM for both canonical and within-month history keys.
func PeriodMonth(p string) string {
	cut := -1
	for _, sep := range []string{"_", "#"} {
		if i := strings.Index(p, sep); i >= 0 && (cut < 0 || i < cut) {
			cut = i
		}
	}
	if cut < 0 {
		return p
	}
	return p[:cut]
}

func sequence(key string) (int64, string) {
	month := PeriodMonth(key)
	if len(key) == len(month) {
		return 0, ""
	}
	suffix := key[len(month)+1:]
	if suffix != "" && strings.Trim(suffix, "0123456789") == "" {
		n, err := strconv.ParseInt(suffix, 10, 64)
		if err != nil {
			n = math.MaxInt64
		}
		return n, suffix
	}
	return 0, suffix
}

type sortKey struct {
	month  string
	bare   int
	seq    int64
	suffix string
}

func keyOf(period string) sortKey {
	month := PeriodMonth(period)
	if len(period) == len(month) {
		return sortKey{month, 0, 0, ""}
	}
	seq, suffix := sequence(period)
	return sortKey{month, 1, seq, suffix}
}

func (a sortKey) less(b sortKey) bool {
	if a.month != b.month {
		return a.month < b.month
	}
	if a.bare != b.bare {
		return a.bare < b.bare
	}
	if a.seq != b.seq {
		return a.seq < b.seq
	}
	return a.suffix < b.suffix
}

// SortHistory sorts by month, then by the within-month change sequence (stable).
func SortHistory(h History) History {
	out := append(History(nil), h...)
	sort.SliceStable(out, func(i, j int) bool { return keyOf(out[i].Period).less(keyOf(out[j].Period)) })
	return out
}

func split(h History, period string) (before, current []int64) {
	for _, p := range h {
		switch m := PeriodMonth(p.Period); {
		case m < period:
			before = append(before, p.Cents)
		case m == period:
			current = append(current, p.Cents)
		}
	}
	return
}

func contains(l []int64, v int64) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

// OfferedPrices: the previous month's closing price first, then each distinct price recorded
// in the month (changing back to an earlier amount does not duplicate a row).
func OfferedPrices(h History, period string) []int64 {
	before, current := split(SortHistory(h), period)
	offered := []int64{}
	if len(before) > 0 {
		offered = append(offered, before[len(before)-1])
	}
	for _, c := range current {
		if !contains(offered, c) {
			offered = append(offered, c)
		}
	}
	return offered
}

// MonthPriceTimeline is the full timeline for the admin UI, repeated values included.
func MonthPriceTimeline(h History, period string) []int64 {
	before, current := split(SortHistory(h), period)
	out := []int64{}
	if len(before) > 0 {
		out = append(out, before[len(before)-1])
	}
	return append(out, current...)
}

var ErrNoPriceBefore = errors.New("history has no price before this period")

// ApplyPriceChange appends a real price change keeping earlier changes of the month. A no-op
// returns the sorted history unchanged. Returns (history, previous month price, current price).
func ApplyPriceChange(h History, period string, newCents int64) (History, int64, int64, error) {
	hist := SortHistory(h)
	var before History
	var current History
	for _, p := range hist {
		switch m := PeriodMonth(p.Period); {
		case m < period:
			before = append(before, p)
		case m == period:
			current = append(current, p)
		}
	}
	if len(before) == 0 {
		return nil, 0, 0, ErrNoPriceBefore
	}
	previous := before[len(before)-1].Cents
	currentPrice := previous
	if len(current) > 0 {
		currentPrice = current[len(current)-1].Cents
	}
	if newCents == currentPrice {
		return hist, previous, currentPrice, nil
	}
	key := period
	if len(current) > 0 {
		used := map[string]bool{}
		var maxSeq int64
		for _, p := range current {
			used[p.Period] = true
			if s, _ := sequence(p.Period); s > maxSeq {
				maxSeq = s
			}
		}
		seq := maxSeq + 1
		key = period + "_" + strconv.FormatInt(seq, 10)
		for used[key] {
			seq++
			key = period + "_" + strconv.FormatInt(seq, 10)
		}
	}
	return SortHistory(append(append(History(nil), hist...), PricePoint{key, newCents})), previous, newCents, nil
}

var ErrEmptyHistory = errors.New("history is empty")

func LatestPrice(h History) (int64, error) {
	o := SortHistory(h)
	if len(o) == 0 {
		return 0, ErrEmptyHistory
	}
	return o[len(o)-1].Cents, nil
}

// Line is one input line of a product: a price with its label ("old", "new", "saved" or "").
type Line struct {
	Price int64
	Label string
}

// LineLabels labels the offered prices and appends saved prices that are no longer offered.
func LineLabels(derived, extra []int64) []Line {
	var lines []Line
	switch {
	case len(derived) == 2:
		lines = []Line{{derived[0], "old"}, {derived[1], "new"}}
	case len(derived) > 2:
		lines = []Line{{derived[0], "old"}}
		for _, p := range derived[1:] {
			lines = append(lines, Line{p, "new"})
		}
	default:
		for _, p := range derived {
			lines = append(lines, Line{p, ""})
		}
	}
	for _, p := range extra {
		if !contains(derived, p) {
			lines = append(lines, Line{p, "saved"})
		}
	}
	return lines
}
