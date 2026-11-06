package reports

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"math"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

type exportState struct {
	Calc  []bool  `json:"calc"`
	Rows  [][]any `json:"rows"`
	Grand int64   `json:"grand"`
}

type dump struct {
	Sheets     []string           `json:"sheets"`
	Cells      [][]any            `json:"cells"`
	Formats    map[string]string  `json:"formats"`
	Bold       []string           `json:"bold"`
	Widths     map[string]float64 `json:"widths"`
	Freeze     string             `json:"freeze"`
	Autofilter string             `json:"autofilter"`
	MaxRow     int                `json:"max_row"`
	MaxCol     int                `json:"max_col"`
}

func summaryFrom(st exportState) *Summary {
	s := &Summary{Grand: st.Grand}
	for _, c := range st.Calc {
		s.Stores = append(s.Stores, SummaryStore{CalculationEnabled: c})
	}
	for _, r := range st.Rows {
		n := func(i int) int64 { return int64(r[i].(float64)) }
		s.Rows = append(s.Rows, SummaryRow{Name: r[0].(string), Price: n(1), Qty: n(2), CalcQty: n(3), Sum: n(4)})
	}
	return s
}

// dumpXLSX reads a workbook back in the same shape as gen_xlsx_golden.dump_workbook.
func dumpXLSX(t *testing.T, data []byte) dump {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	d := dump{Sheets: f.GetSheetList(), Formats: map[string]string{}, Widths: map[string]float64{}}
	sheet := d.Sheets[0]
	rows, _ := f.GetRows(sheet, excelize.Options{RawCellValue: true})
	d.MaxRow = len(rows)
	for r := range rows {
		var line []any
		for c := 1; c <= 5; c++ {
			ref, _ := excelize.CoordinatesToCellName(c, r+1)
			v, _ := f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true})
			ty, _ := f.GetCellType(sheet, ref)
			style, _ := f.GetCellStyle(sheet, ref)
			st, _ := f.GetStyle(style)
			if st != nil {
				if st.NumFmt == 4 {
					d.Formats[ref] = "#,##0.00"
				}
				if st.Font != nil && st.Font.Bold {
					d.Bold = append(d.Bold, ref)
				}
			}
			if v == "" && ty == excelize.CellTypeUnset {
				if c > d.MaxCol && len(line) < 5 {
					line = append(line, nil)
				} else {
					line = append(line, nil)
				}
				continue
			}
			if ty == excelize.CellTypeNumber || ty == excelize.CellTypeUnset {
				var x float64
				if err := json.Unmarshal([]byte(v), &x); err == nil {
					line = append(line, x)
					continue
				}
			}
			line = append(line, v)
		}
		d.Cells = append(d.Cells, line)
	}
	// trim to the used width, as openpyxl's max_column does
	for _, line := range d.Cells {
		for c := len(line); c > d.MaxCol; c-- {
			if line[c-1] != nil {
				d.MaxCol = c
				break
			}
		}
	}
	for i := range d.Cells {
		d.Cells[i] = d.Cells[i][:d.MaxCol]
	}
	for _, col := range []string{"A", "B", "C", "D", "E"} {
		if w, err := f.GetColWidth(sheet, col); err == nil && w != 9.140625 && w != 0 {
			d.Widths[col] = w
		}
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, zf := range zr.File {
		if zf.Name != "xl/worksheets/sheet1.xml" {
			continue
		}
		rc, _ := zf.Open()
		xml, _ := io.ReadAll(rc)
		rc.Close()
		if m := regexp.MustCompile(`<autoFilter ref="([^"]+)"`).FindSubmatch(xml); m != nil {
			d.Autofilter = strings.ReplaceAll(string(m[1]), "$", "") // excelize writes absolute refs
		}
		if m := regexp.MustCompile(`<pane [^>]*topLeftCell="([^"]+)"`).FindSubmatch(xml); m != nil {
			d.Freeze = string(m[1])
		}
	}
	sort.Strings(d.Bold)
	return d
}

func sameNumber(a, b any) bool {
	x, ok1 := a.(float64)
	y, ok2 := b.(float64)
	if ok1 && ok2 {
		return math.Abs(x-y) < 1e-9
	}
	return a == b
}

func TestSummaryXLSXMatchesPythonLayout(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/reports/xlsx_export.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden map[string]struct {
		State    exportState `json:"state"`
		Workbook dump        `json:"workbook"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	for name, g := range golden {
		t.Run(name, func(t *testing.T) {
			data, err := SummaryXLSX(summaryFrom(g.State))
			if err != nil {
				t.Fatal(err)
			}
			if dir := os.Getenv("XLSX_SAMPLE_DIR"); dir != "" { // for checking the files with openpyxl by hand
				os.WriteFile(dir+"/"+name+".xlsx", data, 0o644)
			}
			got, want := dumpXLSX(t, data), g.Workbook
			sort.Strings(want.Bold)
			if len(got.Sheets) != 1 || got.Sheets[0] != want.Sheets[0] {
				t.Errorf("sheets %v want %v", got.Sheets, want.Sheets)
			}
			if len(got.Cells) != len(want.Cells) {
				t.Fatalf("rows %d want %d: %v", len(got.Cells), len(want.Cells), got.Cells)
			}
			for r := range want.Cells {
				if len(got.Cells[r]) != len(want.Cells[r]) {
					t.Fatalf("row %d: %v want %v", r, got.Cells[r], want.Cells[r])
				}
				for c := range want.Cells[r] {
					if !sameNumber(got.Cells[r][c], want.Cells[r][c]) {
						t.Errorf("cell r%d c%d: %v want %v", r+1, c+1, got.Cells[r][c], want.Cells[r][c])
					}
				}
			}
			if !equalJSON(got.Formats, want.Formats) {
				t.Errorf("formats %v want %v", got.Formats, want.Formats)
			}
			if !equalJSON(got.Bold, want.Bold) {
				t.Errorf("bold %v want %v", got.Bold, want.Bold)
			}
			if !equalJSON(got.Widths, want.Widths) {
				t.Errorf("widths %v want %v", got.Widths, want.Widths)
			}
			if got.Freeze != want.Freeze {
				t.Errorf("freeze %q want %q", got.Freeze, want.Freeze)
			}
			if got.Autofilter != want.Autofilter {
				t.Errorf("autofilter %q want %q", got.Autofilter, want.Autofilter)
			}
			if got.MaxCol != want.MaxCol || got.MaxRow != want.MaxRow {
				t.Errorf("size %dx%d want %dx%d", got.MaxRow, got.MaxCol, want.MaxRow, want.MaxCol)
			}
		})
	}
}

func equalJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
