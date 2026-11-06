package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type sessionRow struct {
	ID      int64
	UserID  int64 `json:"user_id"`
	Login   string
	Device  string
	IP      string
	Current bool
}

func (e *env) loginAs(login, pw, ua, addr string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"login":"`+login+`","password":"`+pw+`"}`))
	req.Host, req.RemoteAddr = "testserver", addr
	req.Header.Set("Origin", "http://testserver")
	req.Header.Set("User-Agent", ua)
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, req)
	return w
}

func TestAdminSeesEveryEmployeesDevicesAndCanEndThem(t *testing.T) {
	d := newDesks(t)
	e := d.e
	const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
	const safariIOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1"
	pc := sessionCookie(e.loginAs("desk_a", "desk-a-pass", chromeWin, "198.51.100.10:1"))
	phone := sessionCookie(e.loginAs("desk_a", "desk-a-pass", safariIOS, "198.51.100.11:1"))

	var rows []sessionRow
	w := e.do("GET", "/api/v1/admin/sessions", "", nil, d.boss)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &rows) != nil {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var devices []string
	var mine int
	for _, r := range rows {
		if r.Login == "desk_a" {
			devices = append(devices, r.Device+"@"+r.IP)
		}
		if r.Current {
			mine++
			if r.Login != "boss" {
				t.Fatalf("current marks %s", r.Login)
			}
		}
	}
	if len(devices) != 3 || !contains(devices, "Chrome · Windows@198.51.100.10") || !contains(devices, "Safari · iOS@198.51.100.11") || mine != 1 {
		t.Fatalf("devices %v current %d (all %+v)", devices, mine, rows)
	}

	// Nobody but a user administrator may look.
	if w := e.do("GET", "/api/v1/admin/sessions", "", nil, d.a); w.Code != 403 {
		t.Fatalf("desk: %d", w.Code)
	}
	if w := e.do("GET", "/api/v1/admin/sessions", "", nil, d.view); w.Code != 403 {
		t.Fatalf("viewer: %d", w.Code)
	}
	if w := e.do("GET", "/api/v1/admin/sessions", ""+"", nil); w.Code != 401 {
		t.Fatalf("anonymous: %d", w.Code)
	}

	// End the phone only: the PC keeps working.
	var phoneID int64
	for _, r := range rows {
		if strings.HasPrefix(r.Device, "Safari") {
			phoneID = r.ID
		}
	}
	if w := e.do("DELETE", "/api/v1/admin/sessions/"+itoa(int(phoneID)), "", map[string]string{"Origin": "http://testserver"}, d.boss); w.Code != 200 {
		t.Fatalf("end: %d %s", w.Code, w.Body)
	}
	if e.status(phone) != 401 || e.status(pc) != 200 {
		t.Fatal("only the chosen device is signed out")
	}
	if w := e.do("DELETE", "/api/v1/admin/sessions/"+itoa(int(phoneID)), "", map[string]string{"Origin": "http://testserver"}, d.boss); w.Code != 404 {
		t.Fatalf("again: %d", w.Code)
	}

	// Sign the employee out everywhere.
	uid := rows[0].UserID
	for _, r := range rows {
		if r.Login == "desk_a" {
			uid = r.UserID
		}
	}
	if w := e.do("DELETE", "/api/v1/admin/sessions?user_id="+itoa(int(uid)), "", map[string]string{"Origin": "http://testserver"}, d.boss); w.Code != 200 {
		t.Fatalf("everywhere: %d %s", w.Code, w.Body)
	}
	if e.status(pc) != 401 {
		t.Fatal("every device of the user is signed out")
	}
	var n int
	e.st.R.QueryRow("SELECT COUNT(*) FROM audit_log WHERE action = 'завершено сеанс користувача'").Scan(&n)
	if n != 2 {
		t.Fatalf("audit rows: %d", n)
	}
	if w := e.do("DELETE", "/api/v1/admin/sessions?user_id="+itoa(int(uid)), "", map[string]string{"Origin": "http://testserver"}, d.a); w.Code != 401 && w.Code != 403 {
		t.Fatalf("a non-admin: %d", w.Code)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

var _ = http.StatusOK
