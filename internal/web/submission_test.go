package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

type sub struct {
	By       string
	SignedAt string `json:"signed_at"`
}

type subReport struct {
	ReportID   int64  `json:"report_id"`
	Status     string `json:"status"`
	Submission *sub   `json:"submission"`
	Locked     *sub   `json:"locked"`
}

func submissionEnv(t *testing.T) (*env, *http.Cookie, *http.Cookie, string) {
	e := newEnv(t, nil)
	res, err := e.st.W.Exec("INSERT INTO organisations (name, archived) VALUES ('Філія А', 0)")
	if err != nil {
		t.Fatal(err)
	}
	org, _ := res.LastInsertId()
	e.addUser("clerk", "Оксана Мельник", "Clerk-pass1", &org, "organisation", "reports.submit")
	clerk := sessionCookie(e.login("clerk", "Clerk-pass1"))
	boss := sessionCookie(e.login("boss", "Boss-pass1"))
	return e, clerk, boss, e.now.In(time.Local).Format("2006-01")
}

func (e *env) report(c *http.Cookie, method, path, body string) subReport {
	e.t.Helper()
	w := e.do(method, path, body, nil, c)
	if w.Code != 200 {
		e.t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
	}
	var r subReport
	json.Unmarshal(w.Body.Bytes(), &r)
	return r
}

// Months submitted as a whole (before daily reports) keep their signatures as read-only history: the reviewer
// still sees who submitted and who locked, and the store's first day moves them to the «Без дати» part.
func TestMonthSignaturesStayAsHistory(t *testing.T) {
	e, clerk, boss, period := submissionEnv(t)
	res, _ := e.st.W.Exec("INSERT INTO reports (store_id, period, status) SELECT id, ?, 'submitted' FROM organisations", period)
	rid, _ := res.LastInsertId()
	e.st.W.Exec("INSERT INTO report_submissions (report_id, kind, user_id, user_name, at) VALUES (?, 'store', NULL, 'Оксана Мельник', ?)", rid, e.now.Add(-time.Hour).Unix())
	e.st.W.Exec("INSERT INTO report_submissions (report_id, kind, user_id, user_name, at) VALUES (?, 'admin', NULL, 'boss', ?)", rid, e.now.Unix())
	detail := e.report(boss, "GET", "/api/v1/admin/reports/"+itoa(int(rid)), "")
	if detail.Submission == nil || detail.Submission.By != "Оксана Мельник" || detail.Locked == nil || detail.Locked.By != "boss" {
		t.Fatalf("detail: %+v", detail)
	}
	var days struct {
		Undated *struct {
			Status     string `json:"status"`
			Submission *sub   `json:"submission"`
		} `json:"undated"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/store/reports/"+period+"/days", "", nil, clerk).Body.Bytes(), &days)
	if days.Undated != nil { // the month has no quantities, so there is no undated part
		t.Fatalf("undated: %+v", days.Undated)
	}
}

func TestReportsFromBeforeTheSignatureHaveNone(t *testing.T) {
	e, _, boss, period := submissionEnv(t)
	res, _ := e.st.W.Exec("INSERT INTO reports (store_id, period, status) SELECT id, ?, 'submitted' FROM organisations", period)
	rid, _ := res.LastInsertId()
	body := e.do("GET", "/api/v1/admin/reports/"+itoa(int(rid)), "", nil, boss).Body.String()
	if strings.Contains(body, "submission") || strings.Contains(body, "locked") {
		t.Fatalf("an old report must not claim a submitter: %s", body)
	}
}

// The monthly write endpoints are gone: the month is changed day by day and only reviewed as a whole.
func TestMonthlyWriteEndpointsAreGone(t *testing.T) {
	e, clerk, boss, period := submissionEnv(t)
	if w := e.do("PUT", "/api/v1/store/reports/"+period, `{"action":"draft","quantities":[]}`, nil, clerk); w.Code != 405 {
		t.Fatalf("monthly save: %d", w.Code)
	}
	if w := e.do("PATCH", "/api/v1/admin/reports/1", `{"status":"draft"}`, nil, boss); w.Code != 405 {
		t.Fatalf("month lock: %d", w.Code)
	}
}
