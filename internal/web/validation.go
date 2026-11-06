package web

import (
	"encoding/json"
	"io"
	"legkyi/internal/platform"
	"net/http"
	"strconv"
	"strings"
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
	parent *Body
	prefix string
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
	case platform.RuleError:
		if e.Status == 0 {
			fail(w, FormError{e.Msg})
		} else {
			fail(w, HTTPError{Status: e.Status, Detail: e.Msg})
		}
	case HTTPError:
		for k, v := range e.Headers {
			w.Header().Set(k, v)
		}
		writeJSON(w, e.Status, map[string]string{"detail": e.Detail})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Internal Server Error"})
	}
}

// --- optional/typed body fields ----------------------------------------------------

func (b *Body) has(name string) (json.RawMessage, bool) {
	raw, ok := b.fields[name]
	if ok && string(raw) == "null" {
		return nil, false
	}
	return raw, ok
}

// OptString reads an optional string (default def) limited to max characters (0 = unbounded).
func (b *Body) OptString(name, def string, max int) string {
	raw, ok := b.has(name)
	if !ok {
		return def
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		b.fail(name, "Input should be a valid string", "string_type")
		return def
	}
	if max > 0 && utf8.RuneCountInString(s) > max {
		b.fail(name, "String should have at most "+itoa(max)+" characters", "string_too_long")
	}
	return s
}

// OptInt reads an optional integer; nil when absent or null.
func (b *Body) OptInt(name string) *int64 {
	raw, ok := b.has(name)
	if !ok {
		return nil
	}
	var n int64
	if json.Unmarshal(raw, &n) != nil {
		b.fail(name, "Input should be a valid integer", "int_type")
		return nil
	}
	return &n
}

// OptBool reads an optional boolean (default def).
func (b *Body) OptBool(name string, def bool) bool {
	raw, ok := b.has(name)
	if !ok {
		return def
	}
	var v bool
	if json.Unmarshal(raw, &v) != nil {
		b.fail(name, "Input should be a valid boolean", "bool_type")
		return def
	}
	return v
}

// IntList reads an optional list of integers with at most max items.
func (b *Body) IntList(name string, max int) []int64 {
	raw, ok := b.has(name)
	if !ok {
		return nil
	}
	var v []int64
	if json.Unmarshal(raw, &v) != nil {
		b.fail(name, "Input should be a valid list", "list_type")
		return nil
	}
	if max > 0 && len(v) > max {
		b.fail(name, "List should have at most "+itoa(max)+" items after validation, not "+itoa(len(v)), "too_long")
	}
	return v
}

// StringList reads an optional list of strings with at most max items.
func (b *Body) StringList(name string, max int) []string {
	raw, ok := b.has(name)
	if !ok {
		return nil
	}
	var v []string
	if json.Unmarshal(raw, &v) != nil {
		b.fail(name, "Input should be a valid list", "list_type")
		return nil
	}
	if max > 0 && len(v) > max {
		b.fail(name, "List should have at most "+itoa(max)+" items after validation, not "+itoa(len(v)), "too_long")
	}
	return v
}

// Literal reads a required string that must be one of the allowed values.
func (b *Body) Literal(name string, allowed ...string) string {
	s := b.String(name, 0, 0)
	if s == "" && len(b.errs) > 0 && b.errs[len(b.errs)-1].Loc[len(b.errs[len(b.errs)-1].Loc)-1] == name {
		return ""
	}
	for _, a := range allowed {
		if s == a {
			return s
		}
	}
	quoted := make([]string, len(allowed))
	for i, a := range allowed {
		quoted[i] = "'" + a + "'"
	}
	msg := "Input should be " + quoted[0]
	if len(quoted) > 1 {
		msg = "Input should be " + strings.Join(quoted[:len(quoted)-1], ", ") + " or " + quoted[len(quoted)-1]
	}
	b.fail(name, msg, "literal_error")
	return ""
}

// Object reads an optional nested object as its own Body (error locations are prefixed).
func (b *Body) Object(name string) *Body {
	raw, ok := b.has(name)
	if !ok {
		return nil
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		b.fail(name, "Input should be a valid dictionary or object to extract fields from", "model_attributes_type")
		return nil
	}
	return &Body{fields: m, parent: b, prefix: name}
}

// Merge copies a child's errors into the parent (call after reading the child's fields).
func (b *Body) Merge(child *Body) {
	if child == nil {
		return
	}
	for _, e := range child.errs {
		loc := append([]string{"body", child.prefix}, e.Loc[1:]...)
		b.errs = append(b.errs, FieldError{loc, e.Msg, e.Type})
	}
}

// --- query and path parameters ----------------------------------------------------

type Params struct {
	r    *http.Request
	errs []FieldError
}

func Query(r *http.Request) *Params { return &Params{r: r} }

func (p *Params) fail(kind, name, msg, typ string) {
	p.errs = append(p.errs, FieldError{[]string{kind, name}, msg, typ})
}

// OptInt reads an optional integer query parameter.
func (p *Params) OptInt(name string) *int64 {
	v := p.r.URL.Query().Get(name)
	if !p.r.URL.Query().Has(name) {
		return nil
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil {
		p.fail("query", name, "Input should be a valid integer, unable to parse string as an integer", "int_parsing")
		return nil
	}
	return &n
}

// Int reads an integer query parameter with a default and inclusive bounds.
func (p *Params) Int(name string, def, min, max int64) int64 {
	if !p.r.URL.Query().Has(name) {
		return def
	}
	n := p.OptInt(name)
	if n == nil {
		return def
	}
	if *n < min {
		p.fail("query", name, "Input should be greater than or equal to "+itoa(int(min)), "greater_than_equal")
	} else if *n > max {
		p.fail("query", name, "Input should be less than or equal to "+itoa(int(max)), "less_than_equal")
	}
	return *n
}

// Bool reads a boolean query parameter with Pydantic's accepted spellings.
func (p *Params) Bool(name string, def bool) bool {
	if !p.r.URL.Query().Has(name) {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(p.r.URL.Query().Get(name))) {
	case "true", "1", "yes", "on", "t", "y":
		return true
	case "false", "0", "no", "off", "f", "n":
		return false
	}
	p.fail("query", name, "Input should be a valid boolean, unable to interpret input", "bool_parsing")
	return def
}

// String reads an optional string query parameter ("" when absent).
func (p *Params) String(name string) string { return p.r.URL.Query().Get(name) }

// PathInt reads an integer path parameter.
func (p *Params) PathInt(name string) int64 {
	n, err := strconv.ParseInt(Param(p.r, name), 10, 64)
	if err != nil {
		p.fail("path", name, "Input should be a valid integer, unable to parse string as an integer", "int_parsing")
	}
	return n
}

func (p *Params) Err() error {
	if len(p.errs) == 0 {
		return nil
	}
	return validationError{p.errs}
}
