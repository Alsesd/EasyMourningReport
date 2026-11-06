package reports

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type importGolden struct {
	Status  int        `json:"status"`
	Detail  string     `json:"detail"`
	Message string     `json:"message"`
	Created [][]any    `json:"created"`
	Audit   [][]string `json:"audit"`
}

// deliberate differences from Python, with the reason; everything else must match exactly.
var importDeviations = map[string]string{
	// Python imports the date's text ("2023-03-15 00:00:00") as a product name; the port refuses it.
	"date_name": "рядок 1: назва виглядає як дата або час\nрядок 2: назва виглядає як дата або час",
}

func TestImportFixturesMatchPython(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/reports/xlsx_import.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden map[string]importGolden
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	existing := map[string]bool{"Хліб": true, "Old Stock": true}
	for name, want := range golden {
		t.Run(name, func(t *testing.T) {
			payload, err := os.ReadFile(filepath.Join("../../testdata/reports/xlsx", name+".xlsx"))
			if err != nil {
				t.Fatal(err)
			}
			rows, err := ParseProductsXLSX(payload)
			var fail *ImportFailure
			if err != nil && !errors.As(err, &fail) {
				t.Fatal(err)
			}
			if dev, ok := importDeviations[name]; ok {
				if fail == nil || !strings.HasSuffix(fail.Detail, dev) {
					t.Fatalf("deviation: got %v", err)
				}
				return
			}
			if name == "active_out_of_range" {
				// Python cannot open a workbook whose activeTab is out of range; the port reads the first sheet.
				if fail != nil || len(rows) != 1 || rows[0].Name != "First" {
					t.Fatalf("got %v %v", rows, err)
				}
				return
			}
			if want.Status != 200 {
				if fail == nil || fail.Detail != want.Detail {
					t.Fatalf("want 400 %q\n got %v", want.Detail, err)
				}
				return
			}
			if fail != nil {
				t.Fatalf("unexpected failure: %s", fail.Detail)
			}
			create, skipped := PlanImport(rows, existing)
			if len(create) != len(want.Created) {
				t.Fatalf("created %d want %d (%v)", len(create), len(want.Created), want.Created)
			}
			for i, c := range create {
				if c.Name != want.Created[i][0].(string) || c.Cents != int64(want.Created[i][1].(float64)) {
					t.Errorf("row %d: got %q %d want %v", i, c.Name, c.Cents, want.Created[i])
				}
			}
			if got := ImportMessage(len(create), skipped); got != want.Message {
				t.Errorf("message %q want %q", got, want.Message)
			}
		})
	}
}

func TestPyFloatRepr(t *testing.T) {
	cases := map[float64]string{1: "1.0", 1.5: "1.5", 1e16: "1e+16", 1e-5: "1e-05", 0.0001: "0.0001", 100000: "100000.0",
		1.2345678901234568e16: "1.2345678901234568e+16", 123456789012345.0: "123456789012345.0", 0.30000000000000004: "0.30000000000000004",
		-2.5: "-2.5", 1e15: "1000000000000000.0", 9999999999999998: "9999999999999998.0", 1.5e-7: "1.5e-07", 12345.678: "12345.678"}
	for in, want := range cases {
		if got := pyFloatRepr(in); got != want {
			t.Errorf("%v: got %q want %q", in, got, want)
		}
	}
}

func TestIsDateFormat(t *testing.T) {
	for code, want := range map[string]bool{"yyyy\\-mm\\-dd\\ hh:mm": true, `"d"0`: false, "0.00": false, "General": false,
		"[Red]0.00": false, "[h]:mm:ss": true, `0.00 "kg"`: false, "dd.mm.yyyy": true, `\d0`: false, "0.00;[Red]d": false, "#,##0.00 грн": false} {
		if got := isDateFormat(code); got != want {
			t.Errorf("%q: got %v want %v", code, got, want)
		}
	}
}
