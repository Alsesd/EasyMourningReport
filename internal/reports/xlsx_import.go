package reports

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"legkyi/internal/core"
)

// ImportRow is one product row of an import file.
type ImportRow struct {
	Row   int
	Name  string
	Cents int64
}

// ImportFailure is an import that must be refused; Detail is the user-facing text.
type ImportFailure struct{ Detail string }

func (e *ImportFailure) Error() string { return e.Detail }

const (
	msgUnreadable = "Не вдалося прочитати Excel-файл. Перевірте, що це коректний .xlsx."
	msgNoProducts = "У файлі немає товарів для імпорту"
	msgNoPrice    = "не вказана ціна"
	msgNameIsDate = "назва виглядає як дата або час"
)

var headerWords = map[string]bool{"name": true, "назва": true, "товар": true, "product": true}

// kinds of values a cell can hold once read the way openpyxl (data_only) would see it.
type cellKind int

const (
	cellNone cellKind = iota // no value at all (a missing cell, or a formula without a cached value)
	cellText
	cellInt
	cellFloat
	cellBool
	cellDate // numeric cell with a date/time number format
)

type cellValue struct {
	kind cellKind
	text string // text, or the digits of an int
	num  float64
	b    bool
}

// pyStr is Python's str() of the value openpyxl would return for the cell.
func (c cellValue) pyStr() string {
	switch c.kind {
	case cellText, cellInt:
		return c.text
	case cellFloat:
		return pyFloatRepr(c.num)
	case cellBool:
		if c.b {
			return "True"
		}
		return "False"
	}
	return ""
}

// truthy mirrors `raw or ""`: 0, 0.0, False, "" and None are falsy.
func (c cellValue) truthy() bool {
	switch c.kind {
	case cellText:
		return c.text != ""
	case cellInt:
		return strings.Trim(c.text, "-0") != ""
	case cellFloat:
		return c.num != 0
	case cellBool:
		return c.b
	case cellDate:
		return true
	}
	return false
}

// pyFloatRepr is Python's repr(float).
func pyFloatRepr(f float64) string {
	switch {
	case math.IsNaN(f):
		return "nan"
	case math.IsInf(f, 1):
		return "inf"
	case math.IsInf(f, -1):
		return "-inf"
	}
	s := strconv.FormatFloat(f, 'e', -1, 64) // d[.ddd]e±XX
	mant, expText, _ := strings.Cut(s, "e")
	exp, _ := strconv.Atoi(expText)
	sign := ""
	if strings.HasPrefix(mant, "-") {
		sign, mant = "-", mant[1:]
	}
	digits := strings.Replace(mant, ".", "", 1)
	if exp < -4 || exp >= 16 {
		out := digits[:1]
		if len(digits) > 1 {
			out += "." + digits[1:]
		}
		e := "+"
		if exp < 0 {
			e, exp = "-", -exp
		}
		return fmt.Sprintf("%s%se%s%02d", sign, out, e, exp)
	}
	var out string
	switch {
	case exp < 0:
		out = "0." + strings.Repeat("0", -exp-1) + digits
	case len(digits) <= exp+1:
		out = digits + strings.Repeat("0", exp+1-len(digits)) + ".0"
	default:
		out = digits[:exp+1] + "." + digits[exp+1:]
	}
	return sign + out
}

var (
	quotedOrLocale = regexp.MustCompile(`".*?"|\[(?:[^\]hHmMsS]|[hHmMsS][^\]hHmMsS]|[hHmMsS]{2}[^\]])[^\]]*\]`)
)

// isDateFormat ports openpyxl.styles.numbers.is_date_format.
func isDateFormat(code string) bool {
	code, _, _ = strings.Cut(code, ";")
	code = quotedOrLocale.ReplaceAllString(code, "")
	for i := 0; i < len(code); i++ {
		switch code[i] {
		case 'd', 'm', 'h', 'y', 's', 'D', 'M', 'H', 'Y', 'S':
			if i > 0 && (code[i-1] == '_' || code[i-1] == '\\') {
				continue
			}
			return true
		}
	}
	return false
}

// builtinDateIDs are the built-in number formats whose code contains a date or time letter.
func builtinDate(id int) bool { return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) }

// readCell reads cell ref of sheet the way openpyxl's read-only data_only mode would.
func readCell(f *excelize.File, sheet, ref string, dateStyle func(int) bool) (cellValue, error) {
	t, err := f.GetCellType(sheet, ref)
	if err != nil {
		return cellValue{}, err
	}
	raw := excelize.Options{RawCellValue: true}
	v, err := f.GetCellValue(sheet, ref, raw)
	if err != nil {
		return cellValue{}, err
	}
	switch t {
	case excelize.CellTypeBool:
		return cellValue{kind: cellBool, b: v == "1" || strings.EqualFold(v, "true")}, nil
	case excelize.CellTypeError:
		return cellValue{kind: cellText, text: v}, nil
	case excelize.CellTypeSharedString, excelize.CellTypeInlineString, excelize.CellTypeFormula:
		return cellValue{kind: cellText, text: v}, nil
	case excelize.CellTypeNumber, excelize.CellTypeDate, excelize.CellTypeUnset:
		if v == "" {
			return cellValue{}, nil
		}
		style, err := f.GetCellStyle(sheet, ref)
		if err != nil {
			return cellValue{}, err
		}
		if dateStyle(style) {
			return cellValue{kind: cellDate}, nil
		}
		if strings.ContainsAny(v, ".eE") {
			x, err := strconv.ParseFloat(v, 64)
			if err != nil && !errors.Is(err, strconv.ErrRange) {
				return cellValue{kind: cellText, text: v}, nil
			}
			return cellValue{kind: cellFloat, num: x}, nil
		}
		n, ok := new(big.Int).SetString(strings.TrimSpace(v), 10)
		if !ok {
			return cellValue{kind: cellText, text: v}, nil
		}
		return cellValue{kind: cellInt, text: n.String()}, nil
	}
	return cellValue{kind: cellText, text: v}, nil
}

// ParseProductsXLSX reads columns A (name) and B (price) of the active sheet. Any bad row aborts
// the import with an *ImportFailure listing up to 20 «рядок N: …» lines.
func ParseProductsXLSX(payload []byte) (rows []ImportRow, err error) {
	defer func() {
		if r := recover(); r != nil {
			rows, err = nil, &ImportFailure{msgUnreadable}
		}
	}()
	f, err := excelize.OpenReader(bytes.NewReader(payload), excelize.Options{UnzipXMLSizeLimit: 512 << 20, UnzipSizeLimit: 1 << 30})
	if err != nil {
		return nil, &ImportFailure{msgUnreadable}
	}
	defer f.Close()
	sheet := f.GetSheetName(f.GetActiveSheetIndex())
	if sheet == "" {
		return nil, &ImportFailure{msgUnreadable}
	}
	styleCache := map[int]bool{}
	dateStyle := func(id int) bool {
		if v, ok := styleCache[id]; ok {
			return v
		}
		out := false
		if st, err := f.GetStyle(id); err == nil && st != nil {
			if st.CustomNumFmt != nil {
				out = isDateFormat(*st.CustomNumFmt)
			} else {
				out = builtinDate(st.NumFmt)
			}
		}
		styleCache[id] = out
		return out
	}
	all, err := f.GetRows(sheet, excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, &ImportFailure{msgUnreadable}
	}
	var problems []string
	for i, cells := range all {
		rowNumber := i + 1
		if len(cells) == 0 {
			continue
		}
		a, err := readCell(f, sheet, fmt.Sprintf("A%d", rowNumber), dateStyle)
		if err != nil {
			return nil, &ImportFailure{msgUnreadable}
		}
		b, err := readCell(f, sheet, fmt.Sprintf("B%d", rowNumber), dateStyle)
		if err != nil {
			return nil, &ImportFailure{msgUnreadable}
		}
		if a.kind == cellNone && b.kind == cellNone {
			continue
		}
		name := ""
		if a.truthy() {
			name = a.pyStr()
		}
		if rowNumber == 1 && headerWords[strings.ToLower(strings.TrimSpace(name))] {
			continue
		}
		if a.kind == cellDate {
			problems = append(problems, fmt.Sprintf("рядок %d: %s", rowNumber, msgNameIsDate))
			continue
		}
		clean, err := core.CleanName(name, "Назва")
		if err != nil {
			problems = append(problems, fmt.Sprintf("рядок %d: %s", rowNumber, err.Error()))
			continue
		}
		if b.kind == cellNone || b.kind == cellBool {
			problems = append(problems, fmt.Sprintf("рядок %d: %s", rowNumber, msgNoPrice))
			continue
		}
		priceText := b.pyStr()
		if b.kind == cellDate {
			priceText = "date" // Python str()s a datetime, which is never a price
		}
		cents, err := ToCents(priceText)
		if err != nil {
			problems = append(problems, fmt.Sprintf("рядок %d: %s", rowNumber, err.Error()))
			continue
		}
		rows = append(rows, ImportRow{rowNumber, clean, cents})
	}
	if len(problems) > 0 {
		if len(problems) > 20 {
			problems = problems[:20]
		}
		return nil, &ImportFailure{"Імпорт скасовано — виправте файл:\n" + strings.Join(problems, "\n")}
	}
	if len(rows) == 0 {
		return nil, &ImportFailure{msgNoProducts}
	}
	return rows, nil
}

// PlanImport drops rows whose whitespace-normalised, case-sensitive name already exists (archived
// products included) or appeared earlier in the file.
func PlanImport(rows []ImportRow, existing map[string]bool) (create []ImportRow, skipped int) {
	seen := map[string]bool{}
	for _, r := range rows {
		key := core.NormName(r.Name)
		if existing[key] || seen[key] {
			skipped++
			continue
		}
		seen[key] = true
		create = append(create, r)
	}
	return create, skipped
}

// ImportMessage is the success text of an import.
func ImportMessage(created, skipped int) string {
	if created == 0 {
		return fmt.Sprintf("Нових товарів не додано: усі %d рядків уже існують.", skipped)
	}
	return fmt.Sprintf("Імпорт завершено: додано %d товарів, пропущено дублікатів: %d.", created, skipped)
}
