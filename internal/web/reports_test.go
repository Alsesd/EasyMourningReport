package web

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"legkyi/internal/reports"
	"legkyi/internal/store"
)

func seedDemo(t *testing.T, e *env) {
	t.Helper()
	tx, err := e.st.W.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := reports.SeedDemo(context.Background(), tx, e.now); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestDemoSeedLogins(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	for _, l := range []string{"store1", "store2"} {
		s := e.as(l, strings.ToUpper(l[:1])+l[1:]+"-demo")
		if r := s.json("GET", "/api/v1/store/reports/2026-11", "", 200); r["status"] != "new" {
			t.Fatalf("%s: %v", l, r)
		}
	}
}

func TestConcurrentSavesAndReads(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var bad []string
	note := func(s string) { mu.Lock(); bad = append(bad, s); mu.Unlock() }
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			login := fmt.Sprintf("store%d", i%2+1)
			w := e.login(login, strings.ToUpper(login[:1])+login[1:]+"-demo")
			c := sessionCookie(w)
			if c == nil {
				note(fmt.Sprintf("login %d: %d", i, w.Code))
				return
			}
			body := fmt.Sprintf(`{"action":"draft","quantities":[{"product_id":1,"price_cents":250,"quantity":%d}]}`, i)
			if r := e.do("PUT", "/api/v1/store/reports/2026-11", body, nil, c); r.Code != 200 {
				note(fmt.Sprintf("save %d: %d %s", i, r.Code, r.Body.String()))
			}
			if r := e.do("GET", "/api/v1/store/reports/2026-11", "", nil, c); r.Code != 200 {
				note(fmt.Sprintf("read %d: %d", i, r.Code))
			}
		}(i)
	}
	wg.Wait()
	if len(bad) > 0 {
		t.Fatalf("%d failures, first: %s", len(bad), bad[0])
	}
}

func TestStoreScope(t *testing.T) {
	e := newEnv(t, nil)
	seedDemo(t, e)
	s1, s2 := e.as("store1", "Store1-demo"), e.as("store2", "Store2-demo")
	s1.json("PUT", "/api/v1/store/reports/2026-11", `{"action":"draft","quantities":[{"product_id":1,"price_cents":250,"quantity":3}]}`, 200)
	if r := s2.json("GET", "/api/v1/store/reports/2026-11", "", 200); r["status"] != "new" || r["store_name"] != "Магазин 2" {
		t.Fatalf("store2 sees %v", r)
	}
	if n := count(e, "SELECT COUNT(*) FROM reports r JOIN organisations o ON o.id = r.store_id WHERE o.name = 'Магазин 2'"); n != 0 {
		t.Fatalf("store2 has %d reports", n)
	}
	for _, p := range []string{"/api/v1/admin/reports", "/api/v1/admin/reports/1", "/api/v1/admin/summary?period=2026-11", "/api/v1/admin/products"} {
		if r := s2.do("GET", p, ""); r.Code != http.StatusForbidden {
			t.Fatalf("%s: %d", p, r.Code)
		}
	}
	boss := e.as("boss", "Boss-pass1")
	if r := boss.do("PUT", "/api/v1/store/reports/2026-11", `{"action":"draft","quantities":[]}`); r.Code != http.StatusForbidden {
		t.Fatalf("platform admin must not use store endpoints: %d", r.Code)
	}
}

func TestSettingsOrderUkrainian(t *testing.T) {
	e := newEnv(t, nil)
	for _, n := range []string{"Ґанок", "Їжак", "Іва", "Євген", "абетка", "Яр"} {
		e.st.W.Exec("INSERT INTO organisations (name, archived) VALUES (?, 0)", n)
	}
	boss := e.as("boss", "Boss-pass1")
	w := boss.do("GET", "/api/v1/reports/settings", "")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var got []struct {
		Name string `json:"organisation_name"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	// Python sorts by casefold(), i.e. by code point of the lowered name: є < і < ї < ґ.
	want := []string{"абетка", "Яр", "Євген", "Іва", "Їжак", "Ґанок"}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i].Name != want[i] {
			t.Fatalf("order %d: got %v want %v", i, got, want)
		}
	}
}

func TestBeforeDeleteBackupHoldsDeletedRows(t *testing.T) {
	var bk *store.Backups
	e := newEnv(t, func(d *Deps) {
		bk = &store.Backups{Store: d.Store, Dir: filepath.Join(t.TempDir(), "backups"), Keep: 5,
			Now: func() time.Time { return time.Date(2026, 11, 6, 10, 0, 0, 0, time.Local) }}
		d.Backups = bk
	})
	seedDemo(t, e)
	boss := e.as("boss", "Boss-pass1")
	boss.json("DELETE", "/api/v1/admin/products/3", "", 200)
	if n := count(e, "SELECT COUNT(*) FROM products WHERE id = 3"); n != 0 {
		t.Fatal("product not deleted")
	}
	files := bk.List()
	if len(files) != 1 {
		t.Fatalf("backups: %v", files)
	}
	db, err := sql.Open("sqlite", "file:"+files[0]+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err := db.QueryRow("SELECT name FROM products WHERE id = 3").Scan(&name); err != nil || name != "Молоко, 1 л" {
		t.Fatalf("backup lacks the deleted product: %q %v", name, err)
	}
}
