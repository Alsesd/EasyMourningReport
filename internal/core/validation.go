package core

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// FieldError is one entry of the 422 "errors" list (Pydantic's shape).
type FieldError struct {
	Loc  []any  `json:"loc"`
	Msg  string `json:"msg"`
	Type string `json:"type"`
}

// ValidationError is a 422 with the list of field errors; Errs is the Pydantic-shaped "errors" array.
type ValidationError struct{ Errs []FieldError }

func (ValidationError) Error() string { return "validation failed" }

// Body is a decoded JSON object whose fields are validated one by one.
type Body struct {
	fields map[string]json.RawMessage
	errs   []FieldError
	root   *Body // owner of errs (nil on the root itself)
	base   []any // location prefix of this object, e.g. ["body", "quantities", 0]
}

// ReadBody decodes the request body as a JSON object. Unknown fields are ignored (Pydantic's default).
func ReadBody(r *http.Request) (*Body, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 8<<20))
	if err != nil {
		return nil, ValidationError{[]FieldError{{[]any{"body"}, "Unable to read the request body", "json_invalid"}}}
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		if len(raw) == 0 {
			return nil, ValidationError{[]FieldError{{[]any{"body"}, "Field required", "missing"}}}
		}
		return nil, ValidationError{[]FieldError{{[]any{"body"}, "Input should be a valid dictionary or object to extract fields from", "model_attributes_type"}}}
	}
	return &Body{fields: m, base: []any{"body"}}, nil
}

// Fail records a field error of this object (for rules a module checks itself); Err reports it.
func (b *Body) Fail(name, msg, typ string) { b.fail(name, msg, typ) }

// Raw returns the field's undecoded JSON (nil when absent).
func (b *Body) Raw(name string) json.RawMessage { return b.fields[name] }

// Has reports whether the field is present in the body (even when empty).
func (b *Body) Has(name string) bool { _, ok := b.fields[name]; return ok }

func (b *Body) fail(name, msg, typ string) {
	r := b
	if b.root != nil {
		r = b.root
	}
	loc := make([]any, 0, len(b.base)+1)
	for _, p := range b.base {
		loc = append(loc, fmt.Sprint(p))
	}
	loc = append(loc, name)
	r.errs = append(r.errs, FieldError{loc, msg, typ})
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
		b.fail(name, "String should have at least "+strconv.Itoa(min)+" character"+plural(min), "string_too_short")
	} else if max > 0 && n > max {
		b.fail(name, "String should have at most "+strconv.Itoa(max)+" character"+plural(max), "string_too_long")
	}
	return s
}

// Err returns the accumulated validation error, or nil.
func (b *Body) Err() error {
	if len(b.errs) == 0 {
		return nil
	}
	return ValidationError{b.errs}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// FormError is a user-correctable input error: HTTP 422 {"detail", "code": "validation_error"}.
type FormError struct{ Message string }

func (e FormError) Error() string { return e.Message }

// HTTPError carries a status and a Russian/Ukrainian detail, like FastAPI's HTTPException.
type HTTPError struct {
	Status int
	Detail string
	// Code is an optional machine-readable reason ("car_required"), sent as "code" next to "detail".
	Code    string
	Headers map[string]string
}

func (e HTTPError) Error() string { return e.Detail }

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
		b.fail(name, "String should have at most "+strconv.Itoa(max)+" characters", "string_too_long")
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
		b.fail(name, "List should have at most "+strconv.Itoa(max)+" items after validation, not "+strconv.Itoa(len(v)), "too_long")
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
		b.fail(name, "List should have at most "+strconv.Itoa(max)+" items after validation, not "+strconv.Itoa(len(v)), "too_long")
	}
	return v
}

// Literal reads a required string that must be one of the allowed values.
func (b *Body) Literal(name string, allowed ...string) string {
	s := b.String(name, 0, 0)
	if _, ok := b.fields[name]; !ok {
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

func (b *Body) rootBody() *Body {
	if b.root != nil {
		return b.root
	}
	return b
}

func (b *Body) child(m map[string]json.RawMessage, elem ...any) *Body {
	return &Body{fields: m, root: b.rootBody(), base: append(append([]any{}, b.base...), elem...)}
}

// Object reads an optional nested object; its errors are reported at the full location.
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
	return b.child(m, name)
}

// ObjectList reads an optional list of objects (at most max items).
func (b *Body) ObjectList(name string, max int) []*Body {
	raw, ok := b.has(name)
	if !ok {
		return nil
	}
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		b.fail(name, "Input should be a valid list", "list_type")
		return nil
	}
	if max > 0 && len(items) > max {
		b.fail(name, "List should have at most "+strconv.Itoa(max)+" items after validation, not "+strconv.Itoa(len(items)), "too_long")
		return nil
	}
	out := make([]*Body, len(items))
	for i, it := range items {
		var m map[string]json.RawMessage
		if json.Unmarshal(it, &m) != nil || m == nil {
			out[i] = b.child(map[string]json.RawMessage{}, name, i)
			out[i].fail("", "Input should be a valid dictionary or object to extract fields from", "model_attributes_type")
			out[i].errsTrimLast()
			continue
		}
		out[i] = b.child(m, name, i)
	}
	return out
}

// errsTrimLast drops the trailing empty-name element of the last error's location.
func (b *Body) errsTrimLast() {
	r := b.rootBody()
	e := &r.errs[len(r.errs)-1]
	e.Loc = e.Loc[:len(e.Loc)-1]
}

// Int reads a required integer with a lower bound; exclusive makes the bound "greater than".
func (b *Body) Int(name string, min int64, exclusive bool) int64 {
	raw, ok := b.fields[name]
	if !ok {
		b.fail(name, "Field required", "missing")
		return 0
	}
	var n int64
	if json.Unmarshal(raw, &n) != nil {
		b.fail(name, "Input should be a valid integer", "int_type")
		return 0
	}
	if exclusive && n <= min {
		b.fail(name, "Input should be greater than "+strconv.Itoa(int(min)), "greater_than")
	} else if !exclusive && n < min {
		b.fail(name, "Input should be greater than or equal to "+strconv.Itoa(int(min)), "greater_than_equal")
	}
	return n
}

// OptIntMin reads an optional integer (nil when absent or null) with an inclusive lower bound.
func (b *Body) OptIntMin(name string, min int64) *int64 {
	n := b.OptInt(name)
	if n != nil && *n < min {
		b.fail(name, "Input should be greater than or equal to "+strconv.Itoa(int(min)), "greater_than_equal")
	}
	return n
}

// Bool reads a required boolean.
func (b *Body) Bool(name string) bool {
	raw, ok := b.fields[name]
	if !ok {
		b.fail(name, "Field required", "missing")
		return false
	}
	var v bool
	if json.Unmarshal(raw, &v) != nil {
		b.fail(name, "Input should be a valid boolean", "bool_type")
	}
	return v
}

// OptLiteral reads an optional literal string (def when absent).
func (b *Body) OptLiteral(name, def string, allowed ...string) string {
	if _, ok := b.has(name); !ok {
		return def
	}
	return b.Literal(name, allowed...)
}

// --- query and path parameters ----------------------------------------------------

type Params struct {
	r    *http.Request
	errs []FieldError
}

func Query(r *http.Request) *Params { return &Params{r: r} }

func (p *Params) fail(kind, name, msg, typ string) {
	p.errs = append(p.errs, FieldError{[]any{kind, name}, msg, typ})
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
		p.fail("query", name, "Input should be greater than or equal to "+strconv.Itoa(int(min)), "greater_than_equal")
	} else if *n > max {
		p.fail("query", name, "Input should be less than or equal to "+strconv.Itoa(int(max)), "less_than_equal")
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
	return ValidationError{p.errs}
}
