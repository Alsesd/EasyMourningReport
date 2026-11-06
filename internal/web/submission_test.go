package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

type sub struct {
	By, Kind    string
	SubmittedAt string `json:"submitted_at"`
}

type subReport struct {
	ReportID   int64  `json:"report_id"`
	Status     string `json:"status"`
	Submission *sub   `json:"submission"`
}

func submissionEnv(t *testing.T) (*env, *http.Cookie, *http.Cookie, string) {
	e := newEnv(t, nil)
	res, err := e.st.W.Exec("INSERT INTO organisations (name, archived) VALUES ('Філія А', 0)")
	if err != nil {
		t.Fatal(err)
	}
	org, _ := res.LastInsertId()
	e.addUser("clerk", "Оксана Мельник", "clerk-pass", &org, "organisation", "reports.submit")
	clerk := sessionCookie(e.login("clerk", "clerk-pass"))
	boss := sessionCookie(e.login("boss", "boss-pass"))
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

func TestReportCarriesTheSubmittingEmployee(t *testing.T) {
	e, clerk, boss, period := submissionEnv(t)
	path := "/api/v1/store/reports/" + period

	// A draft has no signature yet.
	if r := e.report(clerk, "PUT", path, `{"action":"draft","quantities":[]}`); r.Submission != nil {
		t.Fatalf("a draft must not be signed: %+v", r.Submission)
	}
	r := e.report(clerk, "PUT", path, `{"action":"submit","quantities":[]}`)
	if r.Status != "submitted" || r.Submission == nil || r.Submission.By != "Оксана Мельник" || r.Submission.Kind != "store" || r.Submission.SubmittedAt == "" {
		t.Fatalf("submit: %+v", r)
	}
	if again := e.report(clerk, "GET", path, ""); again.Submission == nil || again.Submission.By != "Оксана Мельник" {
		t.Fatalf("the store page shows the signature: %+v", again)
	}

	// The administrator sees it in the month list and in the report itself.
	var list []struct {
		StoreName  string `json:"store_name"`
		Submission *sub   `json:"submission"`
	}
	json.Unmarshal(e.do("GET", "/api/v1/admin/reports?period="+period, "", nil, boss).Body.Bytes(), &list)
	if len(list) != 1 || list[0].Submission == nil || list[0].Submission.By != "Оксана Мельник" {
		t.Fatalf("list: %+v", list)
	}
	detail := e.report(boss, "GET", "/api/v1/admin/reports/"+itoa(int(r.ReportID)), "")
	if detail.Submission == nil || detail.Submission.Kind != "store" {
		t.Fatalf("detail: %+v", detail)
	}

	// Locking an already submitted report keeps the employee's signature; unlocking keeps it as the last submission.
	patch := func(status string) subReport {
		return e.report(boss, "PATCH", "/api/v1/admin/reports/"+itoa(int(r.ReportID)), `{"status":"`+status+`"}`)
	}
	if locked := patch("submitted"); locked.Submission == nil || locked.Submission.Kind != "store" {
		t.Fatalf("lock of a submitted report: %+v", locked.Submission)
	}
	if open := patch("draft"); open.Status != "draft" || open.Submission == nil || open.Submission.By != "Оксана Мельник" {
		t.Fatalf("unlock: %+v", open)
	}
}

func TestAdminLockIsRecordedAsALockNotASubmission(t *testing.T) {
	e, clerk, boss, period := submissionEnv(t)
	r := e.report(clerk, "PUT", "/api/v1/store/reports/"+period, `{"action":"draft","quantities":[]}`)
	locked := e.report(boss, "PATCH", "/api/v1/admin/reports/"+itoa(int(r.ReportID)), `{"status":"submitted"}`)
	if locked.Submission == nil || locked.Submission.Kind != "admin" || locked.Submission.By != "boss" {
		t.Fatalf("%+v", locked.Submission)
	}
}

func TestReportsFromBeforeTheSignatureHaveNone(t *testing.T) {
	e, clerk, boss, period := submissionEnv(t)
	r := e.report(clerk, "PUT", "/api/v1/store/reports/"+period, `{"action":"submit","quantities":[]}`)
	e.st.W.Exec("DELETE FROM report_submissions")
	body := e.do("GET", "/api/v1/admin/reports/"+itoa(int(r.ReportID)), "", nil, boss).Body.String()
	if strings.Contains(body, "submission") {
		t.Fatalf("an old report must not claim a submitter: %s", body)
	}
}
