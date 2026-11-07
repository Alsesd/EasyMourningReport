package web

import (
	"net/http"
	"strings"
	"testing"

	"legkyi/internal/system"
)

func TestValidationErrorsReadAsText(t *testing.T) {
	if (validationError{}).Error() == "" || (FormError{Message: "x"}).Error() != "x" || (HTTPError{Detail: "d"}).Error() != "d" {
		t.Fatal("error texts")
	}
}

func TestBodyListHelpersReportShapeErrors(t *testing.T) {
	read := func(js string) *Body {
		r, _ := http.NewRequest("POST", "/", strings.NewReader(js))
		b, err := ReadBody(r)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	b := read(`{"ids": "x", "objs": [1, {"a": 1}], "many": [1,2,3], "lit": "z", "n": "s"}`)
	if b.IntList("ids", 5); b.Err() == nil {
		t.Fatal("IntList type error")
	}
	b = read(`{"many": [1,2,3]}`)
	if b.IntList("many", 2); b.Err() == nil {
		t.Fatal("IntList too long")
	}
	b = read(`{"objs": [1, {"a": 1}]}`)
	if items := b.ObjectList("objs", 5); len(items) != 2 || b.Err() == nil {
		t.Fatalf("a non-object item must be reported: %v", b.Err())
	}
	b = read(`{"objs": "x"}`)
	if b.ObjectList("objs", 5); b.Err() == nil {
		t.Fatal("ObjectList type error")
	}
	b = read(`{"objs": [{},{},{}]}`)
	if b.ObjectList("objs", 2); b.Err() == nil {
		t.Fatal("ObjectList too long")
	}
	b = read(`{"n": "s"}`)
	if b.Int("n", 0, false); b.Err() == nil {
		t.Fatal("Int type error")
	}
	b = read(`{"n": 0}`)
	if b.Int("n", 0, true); b.Err() == nil {
		t.Fatal("exclusive bound")
	}
	b = read(`{}`)
	if b.Int("n", 0, false); b.Err() == nil {
		t.Fatal("missing")
	}
	b = read(`{"x": 1}`)
	if b.OptLiteral("x", "a", "a", "b"); b.Err() == nil {
		t.Fatal("OptLiteral type")
	}
}

func TestUpdateStatusWithoutUpdater(t *testing.T) {
	a := &App{}
	if st := a.updateStatus(); st.Enabled || st.State != "idle" {
		t.Fatalf("%+v", st)
	}
}

func TestEndSessionsOfAUser(t *testing.T) {
	d := newDesks(t)
	hdr := map[string]string{"Origin": "http://testserver"}
	if w := d.e.do("DELETE", "/api/v1/admin/sessions", "", hdr, d.boss); w.Code != 400 {
		t.Fatalf("no user_id: %d", w.Code)
	}
	if w := d.e.do("DELETE", "/api/v1/admin/sessions?user_id=999", "", hdr, d.boss); w.Code != 404 {
		t.Fatalf("unknown user: %d", w.Code)
	}
	if w := d.e.do("DELETE", "/api/v1/admin/sessions?user_id=x", "", hdr, d.boss); w.Code != 422 {
		t.Fatalf("bad user_id: %d", w.Code)
	}
	if w := d.e.do("DELETE", "/api/v1/admin/sessions/abc", "", hdr, d.boss); w.Code != 422 {
		t.Fatalf("bad id: %d", w.Code)
	}
}

func TestDeviceLabels(t *testing.T) {
	for ua, want := range map[string]string{
		"Mozilla/5.0 (X11; Linux) Firefox/120.0":                         "Firefox · Linux",
		"Mozilla/5.0 (Windows NT 10.0) Chrome/126 Safari/537 Edg/126":    "Edge · Windows",
		"Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537":   "Chrome · Android",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Version/17 Safari/6": "Safari · macOS",
		"curl/8": "Невідомий браузер",
		"Mozilla/5.0 (Windows) OPR/90 Chrome/110 Safari/537":             "Opera · Windows",
		"Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115": "Samsung Internet · Android",
		"Mozilla/5.0 (iPad; CPU OS 17) Safari/604":                       "Safari · iOS",
	} {
		if got := deviceLabel(ua); got != want {
			t.Errorf("%q: %q, want %q", ua, got, want)
		}
	}
}

func TestSessionLongUserAgentIsCut(t *testing.T) {
	a := &App{Deps: Deps{Trusted: ParseTrustedHosts("127.0.0.1")}}
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = "1.2.3.4:5"
	r.Header.Set("User-Agent", strings.Repeat("x", 1000))
	if m := a.metaOf(r); len(m.UserAgent) != 300 || m.IP != "1.2.3.4" {
		t.Fatalf("%d %q", len(m.UserAgent), m.IP)
	}
}

var _ = system.TunnelStatus{}
