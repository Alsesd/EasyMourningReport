package web

import (
	"database/sql"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"legkyi/internal/platform"
	"legkyi/internal/reports"
)

const (
	maxImportBytes = 10 * 1024 * 1024
	xlsxType       = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

type importResultDTO struct {
	Message string `json:"message"`
}

func missingFile() error {
	return validationError{[]FieldError{{Loc: []any{"body", "file"}, Msg: "Field required", Type: "missing"}}}
}

// uploadedFile returns the multipart part named "file", or a 422 like FastAPI's File(...).
func uploadedFile(r *http.Request) (*multipart.Part, error) {
	mr, err := r.MultipartReader()
	if err != nil {
		return nil, missingFile()
	}
	for {
		part, err := mr.NextPart()
		if err != nil {
			return nil, missingFile()
		}
		if part.FormName() == "file" && part.FileName() != "" {
			return part, nil
		}
	}
}

func (a *App) importProducts(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	r.Body = http.MaxBytesReader(w, r.Body, 4*maxImportBytes)
	part, err := uploadedFile(r)
	if err != nil {
		return err
	}
	if !strings.HasSuffix(strings.ToLower(part.FileName()), ".xlsx") {
		return HTTPError{Status: 400, Detail: "Завантажте файл Excel у форматі .xlsx"}
	}
	payload, err := io.ReadAll(io.LimitReader(part, maxImportBytes+1))
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		payload = nil
	} else if err != nil {
		return err
	}
	if len(payload) == 0 || len(payload) > maxImportBytes {
		return HTTPError{Status: 400, Detail: "Файл порожній або перевищує 10 МБ"}
	}
	rows, err := reports.ParseProductsXLSX(payload)
	var fail *reports.ImportFailure
	if errors.As(err, &fail) {
		return HTTPError{Status: 400, Detail: fail.Detail}
	}
	if err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	var message string
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		ctx := r.Context()
		existing := map[string]bool{}
		rs, err := tx.QueryContext(ctx, "SELECT name FROM products")
		if err != nil {
			return err
		}
		for rs.Next() {
			var n string
			if err := rs.Scan(&n); err != nil {
				rs.Close()
				return err
			}
			existing[platform.NormName(n)] = true
		}
		if err := rs.Err(); err != nil {
			rs.Close()
			return err
		}
		rs.Close()
		create, skipped := reports.PlanImport(rows, existing)
		for _, row := range create {
			res, err := tx.ExecContext(ctx, "INSERT INTO products (name, price_cents, active, archived) VALUES (?, ?, 1, 0)", row.Name, row.Cents)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			if _, err := tx.ExecContext(ctx, "INSERT INTO product_prices (product_id, period, price_cents) VALUES (?, ?, ?)", id, reports.BasePeriod, row.Cents); err != nil {
				return err
			}
		}
		if len(create) > 0 {
			detail := "створено: " + strconv.Itoa(len(create)) + ", пропущено дублікатів: " + strconv.Itoa(skipped)
			if err := platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "масово додано товари", detail); err != nil {
				return err
			}
		}
		message = reports.ImportMessage(len(create), skipped)
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, importResultDTO{message})
	return nil
}

func (a *App) exportSummary(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pm := Query(r)
	submittedOnly := pm.Bool("submitted_only", false)
	if err := pm.Err(); err != nil {
		return err
	}
	selected, err := a.parsePeriod(pm.String("period"))
	if err != nil {
		return err
	}
	s, err := reports.BuildSummary(r.Context(), a.Store.R, selected, submittedOnly)
	if err != nil {
		return err
	}
	data, err := reports.SummaryXLSX(s)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", xlsxType)
	w.Header().Set("Content-Disposition", `attachment; filename="zvit-`+selected+`.xlsx"`)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, err = w.Write(data)
	return err
}
