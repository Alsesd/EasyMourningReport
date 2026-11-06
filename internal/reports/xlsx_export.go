package reports

import (
	"fmt"

	"github.com/xuri/excelize/v2"
)

// SummaryXLSX renders the month summary as the one-sheet matrix workbook («Звіт»): a header row, a
// row per product, a bold «Разом» row, frozen header, autofilter over the product rows, and
// #,##0.00 on the money columns.
func SummaryXLSX(s *Summary) ([]byte, error) {
	calc := false
	for _, st := range s.Stores {
		calc = calc || st.CalculationEnabled
	}
	f := excelize.NewFile()
	defer f.Close()
	const sheet = "Звіт"
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		return nil, err
	}
	headers := []any{"Назва", "Ціна", "Звітована кількість"}
	if calc {
		headers = append(headers, "Кількість по розрахунку")
	}
	headers = append(headers, "Сума")
	var qty, calcQty int64
	table := [][]any{headers}
	for _, r := range s.Rows {
		row := []any{r.Name, float64(r.Price) / 100, r.Qty}
		if calc {
			row = append(row, r.CalcQty)
		}
		table = append(table, append(row, float64(r.Sum)/100))
		qty += r.Qty
		calcQty += r.CalcQty
	}
	totals := []any{"Разом", nil, qty}
	if calc {
		totals = append(totals, calcQty)
	}
	table = append(table, append(totals, float64(s.Grand)/100))
	for i, row := range table {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow(sheet, cell, &row); err != nil {
			return nil, err
		}
	}
	last := "D"
	widths := map[string]float64{"A": 36, "B": 16, "C": 24, "D": 18}
	money := []string{"B", "D"}
	if calc {
		last = "E"
		widths["D"], widths["E"] = 30, 18
		money = []string{"B", "E"}
	}
	maxRow := len(table)
	for col, w := range widths {
		if err := f.SetColWidth(sheet, col, col, w); err != nil {
			return nil, err
		}
	}
	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}
	moneyStyle, err := f.NewStyle(&excelize.Style{NumFmt: 4}) // #,##0.00
	if err != nil {
		return nil, err
	}
	moneyBold, err := f.NewStyle(&excelize.Style{NumFmt: 4, Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}
	for _, c := range money {
		for r := 2; r < maxRow; r++ {
			if err := f.SetCellStyle(sheet, fmt.Sprintf("%s%d", c, r), fmt.Sprintf("%s%d", c, r), moneyStyle); err != nil {
				return nil, err
			}
		}
	}
	if err := f.SetCellStyle(sheet, "A1", last+"1", bold); err != nil {
		return nil, err
	}
	if err := f.SetCellStyle(sheet, fmt.Sprintf("A%d", maxRow), fmt.Sprintf("%s%d", last, maxRow), bold); err != nil {
		return nil, err
	}
	for _, c := range money {
		if err := f.SetCellStyle(sheet, fmt.Sprintf("%s%d", c, maxRow), fmt.Sprintf("%s%d", c, maxRow), moneyBold); err != nil {
			return nil, err
		}
	}
	if err := f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft",
		Selection: []excelize.Selection{{SQRef: "A2", ActiveCell: "A2", Pane: "bottomLeft"}}}); err != nil {
		return nil, err
	}
	filterEnd := maxRow - 1
	if err := f.AutoFilter(sheet, fmt.Sprintf("A1:%s%d", last, filterEnd), nil); err != nil {
		return nil, err
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
