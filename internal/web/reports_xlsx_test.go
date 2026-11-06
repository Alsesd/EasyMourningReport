package web

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func (e *env) upload(s session, field, filename string, content []byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile(field, filename)
	fw.Write(content)
	mw.Close()
	return e.do("POST", "/api/v1/admin/products/import", buf.String(),
		map[string]string{"Content-Type": mw.FormDataContentType()}, s.c)
}

func TestImportEndpoint(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	boss := e.as("boss", "Boss-pass1")
	good, err := os.ReadFile("../../testdata/reports/xlsx/plain_header_en.xlsx")
	if err != nil {
		t.Fatal(err)
	}

	if w := e.upload(boss, "other", "a.xlsx", good); w.Code != 422 || !strings.Contains(w.Body.String(), `"file"`) {
		t.Fatalf("missing field: %d %s", w.Code, w.Body.String())
	}
	if w := e.upload(boss, "file", "a.csv", good); w.Code != 400 {
		t.Fatalf("wrong extension: %d", w.Code)
	}
	if w := e.upload(boss, "file", "EMPTY.XLSX", nil); w.Code != 400 || !strings.Contains(w.Body.String(), "10 МБ") {
		t.Fatalf("empty: %d %s", w.Code, w.Body.String())
	}
	huge := bytes.Repeat([]byte("x"), maxImportBytes+1)
	if w := e.upload(boss, "file", "big.xlsx", huge); w.Code != 400 || !strings.Contains(w.Body.String(), "10 МБ") {
		t.Fatalf("too big: %d %s", w.Code, w.Body.String())
	}
	if w := e.upload(boss, "file", "junk.xlsx", []byte("not a zip")); w.Code != 400 || !strings.Contains(w.Body.String(), "Не вдалося прочитати") {
		t.Fatalf("junk: %d %s", w.Code, w.Body.String())
	}

	w := e.upload(boss, "file", "ok.XLSX", good)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "додано 2 товарів, пропущено дублікатів: 1") {
		t.Fatalf("import: %d %s", w.Code, w.Body.String())
	}
	if n := count(e, "SELECT COUNT(*) FROM products WHERE name IN ('Bread','Milk')"); n != 2 {
		t.Fatalf("products created: %d", n)
	}
	if n := count(e, "SELECT COUNT(*) FROM product_prices p JOIN products x ON x.id = p.product_id WHERE x.name IN ('Bread','Milk') AND p.period = '0000-00'"); n != 2 {
		t.Fatalf("base prices: %d", n)
	}
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action = 'масово додано товари' AND detail = 'створено: 2, пропущено дублікатів: 1'"); n != 1 {
		t.Fatalf("audit rows: %d", n)
	}
	// Importing the same file again creates nothing and writes no audit row.
	w = e.upload(boss, "file", "ok.xlsx", good)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Нових товарів не додано: усі 3 рядків уже існують.") {
		t.Fatalf("second import: %d %s", w.Code, w.Body.String())
	}
	if n := count(e, "SELECT COUNT(*) FROM audit_log WHERE action = 'масово додано товари'"); n != 1 {
		t.Fatalf("audit rows after repeat: %d", n)
	}
	// A failing file changes nothing.
	bad, _ := os.ReadFile("../../testdata/reports/xlsx/mixed_good_bad.xlsx")
	before := count(e, "SELECT COUNT(*) FROM products")
	if w := e.upload(boss, "file", "bad.xlsx", bad); w.Code != 400 || !strings.Contains(w.Body.String(), "рядок 2:") {
		t.Fatalf("bad rows: %d %s", w.Code, w.Body.String())
	}
	if count(e, "SELECT COUNT(*) FROM products") != before {
		t.Fatal("a rejected import must not create products")
	}
	// Store users cannot import or export.
	s1 := e.as("store1", "Store1-demo")
	if w := e.upload(s1, "file", "ok.xlsx", good); w.Code != 403 {
		t.Fatalf("store import: %d", w.Code)
	}
	if w := s1.do("GET", "/api/v1/admin/summary.xlsx", ""); w.Code != 403 {
		t.Fatalf("store export: %d", w.Code)
	}
}

func TestExportEndpoint(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	s1 := e.as("store1", "Store1-demo")
	s1.json("PUT", "/api/v1/store/reports/2026-11", `{"action":"submit","quantities":[{"product_id":1,"price_cents":250,"quantity":4}]}`, 200)
	boss := e.as("boss", "Boss-pass1")
	w := boss.do("GET", "/api/v1/admin/summary.xlsx?period=2026-11&submitted_only=true", "")
	if w.Code != 200 || w.Header().Get("Content-Type") != xlsxType {
		t.Fatalf("%d %s", w.Code, w.Header().Get("Content-Type"))
	}
	if cd := w.Header().Get("Content-Disposition"); cd != `attachment; filename="zvit-2026-11.xlsx"` {
		t.Fatalf("disposition %q", cd)
	}
	if !bytes.HasPrefix(w.Body.Bytes(), []byte("PK")) {
		t.Fatal("not a zip")
	}
	if w := boss.do("GET", "/api/v1/admin/summary.xlsx?period=nope", ""); w.Code != 400 {
		t.Fatalf("bad period: %d", w.Code)
	}
}
