package platform

import (
	"context"
	"testing"
	"time"
)

func TestUserHelpers(t *testing.T) {
	archived := &Organisation{ID: 7, Name: "x", Archived: true}
	if (User{Active: false}).CanSignIn() || (User{Active: true, Org: archived}).CanSignIn() {
		t.Fatal("disabled or archived")
	}
	if !(User{Active: true}).CanSignIn() || !(User{Active: true, Org: &Organisation{ID: 1}}).CanSignIn() {
		t.Fatal("platform user and division user sign in")
	}
	if (&Principal{User: User{}}).OrganisationID() != nil {
		t.Fatal("platform user has no division")
	}
	if id := (&Principal{User: User{Org: &Organisation{ID: 9}}}).OrganisationID(); id == nil || *id != 9 {
		t.Fatal("division id")
	}
}

func TestLoadUserByLoginAndAudit(t *testing.T) {
	s, _ := seeded(t, map[string]string{"ADMIN_PASSWORD": "Secret-pw1"})
	ctx := context.Background()
	u, err := LoadUserByLogin(ctx, s.R, "admin")
	if err != nil || u == nil || u.Login != "admin" {
		t.Fatalf("%v %v", u, err)
	}
	if none, err := LoadUserByLogin(ctx, s.R, "nobody"); err != nil || none != nil {
		t.Fatalf("%v %v", none, err)
	}
	tx, _ := s.W.Begin()
	if err := Audit(tx, time.Now(), "1.2.3.4", "admin", "Адміністратор", "вхід", "x"); err != nil {
		t.Fatal(err)
	}
	tx.Commit()
	var n int
	s.R.QueryRow("SELECT COUNT(*) FROM audit_log WHERE ip = '1.2.3.4'").Scan(&n)
	if n != 1 {
		t.Fatal("audit row")
	}
}
