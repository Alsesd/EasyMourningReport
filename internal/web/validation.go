package web

import (
	"encoding/json"
	"io"
	"net/http"
	"unicode/utf8"
)

// FieldError is one entry of the 422 "errors" list (Pydantic's shape).
type FieldError struct {
	Loc  []string `json:"loc"`
	Msg  string   `json:"msg"`
	Type string   `json:"type"`
}

type validationError struct{ errs []FieldError }

func (validationError) Error() string { return "validation failed" }

// Body is a decoded JSON object whose fields are validated one by one.
type Body struct {
	fields map[string]json.RawMessage
	errs   []FieldError
}

// ReadBody decodes the request body as a JSON object. Unknown fields are ignored (Pydantic's default).
func ReadBody(r *http.Request) (*Body, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 8<<20))
	if err != nil {
		return nil, validationError{[]FieldError{{[]string{"body"}, "Unable to read the request body", "json_invalid"}}}
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		if len(raw) == 0 {
			return nil, validationError{[]FieldError{{[]string{"body"}, "Field required", "missing"}}}
		}
		return nil, validationError{[]FieldError{{[]string{"body"}, "Input should be a valid dictionary or object to extract fields from", "model_attributes_type"}}}
	}
	return &Body{fields: m}, nil
}

func (b *Body) fail(name, msg, typ string) {
	b.errs = append(b.errs, FieldError{[]string{"body", name}, msg, typ})
}

// String reads a required string field with a length range in characters (max 0 = unbounded).
func (b *Body) String(name string, min, max int) string {
	raw, ok := b.fields[name]
	if !ok {
		b.fail(name, "Field required", "missing")
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		b.fail(name, "Input should be a valid string", "string_type")
		return ""
	}
	n := utf8.RuneCountInString(s)
	if n < min {
		b.fail(name, "String should have at least "+itoa(min)+" character"+plural(min), "string_too_short")
	} else if max > 0 && n > max {
		b.fail(name, "String should have at most "+itoa(max)+" character"+plural(max), "string_too_long")
	}
	return s
}

// Err returns the accumulated validation error, or nil.
func (b *Body) Err() error {
	if len(b.errs) == 0 {
		return nil
	}
	return validationError{b.errs}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// FormError is a user-correctable input error: HTTP 422 {"detail", "code": "validation_error"}.
type FormError struct{ Message string }

func (e FormError) Error() string { return e.Message }

// HTTPError carries a status and a Russian/Ukrainian detail, like FastAPI's HTTPException.
type HTTPError struct {
	Status  int
	Detail  string
	Headers map[string]string
}

func (e HTTPError) Error() string { return e.Detail }

// fail writes the response for an error returned by a handler.
func fail(w http.ResponseWriter, err error) {
	switch e := err.(type) {
	case validationError:
		writeJSON(w, http.StatusUnprocessableEntity, struct {
			Detail string       `json:"detail"`
			Errors []FieldError `json:"errors"`
		}{"Некоректні дані запиту.", e.errs})
	case FormError:
		writeJSON(w, http.StatusUnprocessableEntity, struct {
			Detail string `json:"detail"`
			Code   string `json:"code"`
		}{e.Message, "validation_error"})
	case HTTPError:
		for k, v := range e.Headers {
			w.Header().Set(k, v)
		}
		writeJSON(w, e.Status, map[string]string{"detail": e.Detail})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Internal Server Error"})
	}
}
