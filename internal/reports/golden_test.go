package reports

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Golden files come from testdata/reports/gen_golden.py (the Python implementation).

func load(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile("../../testdata/reports/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestToCentsMatchesPython(t *testing.T) {
	var cases []struct {
		In          string `json:"in"`
		Cents       *int64 `json:"cents"`
		Error       string `json:"error"`
		PythonCrash string `json:"python_crash"`
	}
	load(t, "money.json", &cases)
	if len(cases) < 50 {
		t.Fatal("golden file too small")
	}
	for _, c := range cases {
		got, err := ToCents(c.In)
		switch {
		case c.Cents != nil:
			if err != nil || got != *c.Cents {
				t.Errorf("%q: got %d,%v want %d", c.In, got, err, *c.Cents)
			}
		case c.Error != "":
			if err == nil || err.Error() != c.Error {
				t.Errorf("%q: got %d,%v want error %q", c.In, got, err, c.Error)
			}
		default: // Python answered 500; Go returns the normal form error
			if err == nil {
				t.Errorf("%q: Python crashed (%s); Go must reject, got %d", c.In, c.PythonCrash, got)
			}
		}
	}
}

func TestFormatMoney(t *testing.T) {
	for in, want := range map[int64]string{0: "0.00", 5: "0.05", 95: "0.95", 250: "2.50", 100050: "1000.50", 1_000_000_000: "10000000.00"} {
		if got := FormatMoney(in); got != want {
			t.Errorf("%d: %s", in, got)
		}
	}
}

type pp = [2]any

func hist(raw [][]any) History {
	var h History
	for _, r := range raw {
		h = append(h, PricePoint{r[0].(string), int64(r[1].(float64))})
	}
	return h
}

func histOut(h History) [][]any {
	out := [][]any{}
	for _, p := range h {
		out = append(out, []any{p.Period, float64(p.Cents)})
	}
	return out
}

func ints(l []int64) []any {
	out := []any{}
	for _, v := range l {
		out = append(out, float64(v))
	}
	return out
}

func TestPricingMatchesPython(t *testing.T) {
	var g struct {
		SortHistory []struct {
			In, Out [][]any
		} `json:"sort_history"`
		Offered []struct {
			Name, Period string
			In           [][]any
			Out          []float64
		}
		Timeline []struct {
			Name, Period string
			In           [][]any
			Out          []float64
		}
		Apply []struct {
			Name, Period string
			Cents        int64
			In, History  [][]any
			Previous     int64
			Now          int64
			Error        string
		}
		Latest []struct {
			In  [][]any
			Out int64
		}
		Labels []struct {
			Derived, Extra []int64
			Out            [][]any
		}
		PeriodMonth []struct{ In, Out string } `json:"period_month"`
	}
	load(t, "pricing.json", &g)
	if len(g.Apply) < 100 || len(g.Offered) < 30 {
		t.Fatal("golden file too small")
	}
	for _, c := range g.SortHistory {
		if got := histOut(SortHistory(hist(c.In))); !reflect.DeepEqual(got, c.Out) {
			t.Errorf("sort %v: got %v want %v", c.In, got, c.Out)
		}
	}
	f := func(l []float64) []any {
		out := []any{}
		for _, v := range l {
			out = append(out, v)
		}
		return out
	}
	for _, c := range g.Offered {
		if got := ints(OfferedPrices(hist(c.In), c.Period)); !reflect.DeepEqual(got, f(c.Out)) {
			t.Errorf("offered %s %s: got %v want %v", c.Name, c.Period, got, c.Out)
		}
	}
	for _, c := range g.Timeline {
		if got := ints(MonthPriceTimeline(hist(c.In), c.Period)); !reflect.DeepEqual(got, f(c.Out)) {
			t.Errorf("timeline %s %s: got %v want %v", c.Name, c.Period, got, c.Out)
		}
	}
	for _, c := range g.Apply {
		h, prev, now, err := ApplyPriceChange(hist(c.In), c.Period, c.Cents)
		if c.Error != "" {
			if err == nil {
				t.Errorf("apply %s %s %d: expected error", c.Name, c.Period, c.Cents)
			}
			continue
		}
		if err != nil || !reflect.DeepEqual(histOut(h), c.History) || prev != c.Previous || now != c.Now {
			t.Errorf("apply %s %s %d: got %v %d %d %v want %v %d %d", c.Name, c.Period, c.Cents, histOut(h), prev, now, err, c.History, c.Previous, c.Now)
		}
	}
	for _, c := range g.Latest {
		if got, err := LatestPrice(hist(c.In)); err != nil || got != c.Out {
			t.Errorf("latest: %d %v", got, err)
		}
	}
	for _, c := range g.Labels {
		got := [][]any{}
		for _, l := range LineLabels(c.Derived, c.Extra) {
			got = append(got, []any{float64(l.Price), l.Label})
		}
		want := [][]any{}
		for _, r := range c.Out {
			want = append(want, []any{r[0], r[1]})
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("labels %v %v: got %v want %v", c.Derived, c.Extra, got, want)
		}
	}
	for _, c := range g.PeriodMonth {
		if got := PeriodMonth(c.In); got != c.Out {
			t.Errorf("period_month %q: %q want %q", c.In, got, c.Out)
		}
	}
}
