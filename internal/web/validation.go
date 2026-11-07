package web

import (
	"net/http"
	"strconv"

	"legkyi/internal/core"
	"legkyi/internal/platform"
)

// The request-validation types live in core (modules use them too); the shell keeps its short names.
type (
	FieldError = core.FieldError
	Body       = core.Body
	Params     = core.Params
	FormError  = core.FormError
	HTTPError  = core.HTTPError

	validationError = core.ValidationError
)

var (
	ReadBody = core.ReadBody
	Query    = core.Query
	Param    = core.Param
)

func itoa(n int) string { return strconv.Itoa(n) }

// fail writes the response for an error returned by a handler.
func fail(w http.ResponseWriter, err error) {
	switch e := err.(type) {
	case validationError:
		writeJSON(w, http.StatusUnprocessableEntity, struct {
			Detail string       `json:"detail"`
			Errors []FieldError `json:"errors"`
		}{"Некоректні дані запиту.", e.Errs})
	case FormError:
		writeJSON(w, http.StatusUnprocessableEntity, struct {
			Detail string `json:"detail"`
			Code   string `json:"code"`
		}{e.Message, "validation_error"})
	case platform.RuleError:
		if e.Status == 0 {
			fail(w, FormError{Message: e.Msg})
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
