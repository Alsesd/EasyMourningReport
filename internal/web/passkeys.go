package web

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"legkyi/internal/platform"
)

// Passkeys (WebAuthn): the device's fingerprint, face or screen lock replaces the password. Only discoverable
// credentials with user verification are accepted, attestation is not requested ("none"), and the private key
// never leaves the device; the server keeps the public key and a signature counter.

const (
	maxPasskeysPerUser = 10
	challengeTTL       = 5 * time.Minute
	maxChallenges      = 2000
	maxChallengesPerIP = 20
)

// passkeyLimiterKey puts the failures of one address in their own buckets (the limiter's "login" slot is
// shared by every address, so a constant would let one client lock the others out).
func passkeyLimiterKey(ip string) string { return "\x00passkey\x00" + ip }

var errPasskey = errors.New("passkey")

type pendingChallenge struct {
	kind      string // "register" | "login"
	uid       int64
	ip        string
	challenge []byte
	expires   time.Time
}

// challenges are single-use and live in memory: a restart only asks the user to try again.
type challenges struct {
	mu sync.Mutex
	m  map[string]pendingChallenge
}

func (c *challenges) issue(kind string, uid int64, ip string, now time.Time) (id string, challenge []byte, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[string]pendingChallenge{}
	}
	for k, v := range c.m {
		if now.After(v.expires) {
			delete(c.m, k)
		}
	}
	perIP := 0
	for _, v := range c.m {
		if v.ip == ip {
			perIP++
		}
	}
	if len(c.m) >= maxChallenges || perIP >= maxChallengesPerIP {
		return "", nil, HTTPError{Status: 429, Detail: "Забагато запитів. Спробуйте за хвилину."}
	}
	challenge = make([]byte, 32)
	if _, err = rand.Read(challenge); err != nil {
		return "", nil, err
	}
	if id, err = newToken(); err != nil {
		return "", nil, err
	}
	c.m[id] = pendingChallenge{kind, uid, ip, challenge, now.Add(challengeTTL)}
	return id, challenge, nil
}

// take removes and returns a challenge (used once, success or not).
func (c *challenges) take(id, kind string, uid int64, now time.Time) (pendingChallenge, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.m[id]
	delete(c.m, id)
	if !ok || p.kind != kind || p.uid != uid || now.After(p.expires) {
		return pendingChallenge{}, false
	}
	return p, true
}

var b64 = base64.RawURLEncoding

// relyingParty derives the WebAuthn relying party from the page the browser is on: the Origin header the
// same-origin guard already checked. PASSKEY_RP_ID pins the id when the app answers on several host names.
func (a *App) relyingParty(r *http.Request) (rpID, origin string, err error) {
	origin = r.Header.Get("Origin")
	u, perr := url.Parse(origin)
	if perr != nil || u.Host == "" || (u.Scheme != "https" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
		return "", "", HTTPError{Status: 400, Detail: "Ключі доступу працюють лише через захищене з'єднання (https)."}
	}
	rpID = u.Hostname()
	if a.PasskeyRPID != "" {
		if rpID != a.PasskeyRPID && !strings.HasSuffix(rpID, "."+a.PasskeyRPID) {
			return "", "", HTTPError{Status: 400, Detail: "Ця адреса не підходить для ключів доступу."}
		}
		rpID = a.PasskeyRPID
	}
	return rpID, origin, nil
}

func userHandle(uid int64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(uid))
	return b
}

type clientData struct {
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
	Origin    string `json:"origin"`
}

// checkClientData verifies the browser-signed context of a ceremony.
func checkClientData(raw []byte, typ string, challenge []byte, origin string) error {
	var cd clientData
	if json.Unmarshal(raw, &cd) != nil || cd.Type != typ || cd.Origin != origin || cd.Challenge != b64.EncodeToString(challenge) {
		return errPasskey
	}
	return nil
}

type authData struct {
	flags     byte
	signCount uint32
	credID    []byte
	key       map[any]any
}

const (
	flagUP = 0x01
	flagUV = 0x04
	flagAT = 0x40
)

func parseAuthData(b []byte, rpID string, withCredential bool) (authData, error) {
	var ad authData
	if len(b) < 37 {
		return ad, errPasskey
	}
	hash := sha256.Sum256([]byte(rpID))
	if string(b[:32]) != string(hash[:]) {
		return ad, errPasskey
	}
	ad.flags = b[32]
	ad.signCount = binary.BigEndian.Uint32(b[33:37])
	if ad.flags&flagUP == 0 || ad.flags&flagUV == 0 { // present and verified (fingerprint, face, PIN)
		return ad, errPasskey
	}
	if !withCredential {
		return ad, nil
	}
	if ad.flags&flagAT == 0 || len(b) < 55 {
		return ad, errPasskey
	}
	n := int(binary.BigEndian.Uint16(b[53:55]))
	if n == 0 || n > 1023 || len(b) < 55+n {
		return ad, errPasskey
	}
	ad.credID = b[55 : 55+n]
	key, _, err := decodeCBOR(b[55+n:])
	m, ok := key.(map[any]any)
	if err != nil || !ok {
		return ad, errPasskey
	}
	ad.key = m
	return ad, nil
}

// coseToPublicKey converts an ES256 (P-256) or RS256 COSE key to PKIX DER.
func coseToPublicKey(m map[any]any) ([]byte, error) {
	kty, _ := m[int64(1)].(int64)
	alg, _ := m[int64(3)].(int64)
	switch {
	case kty == 2 && alg == -7:
		if crv, _ := m[int64(-1)].(int64); crv != 1 {
			return nil, errPasskey
		}
		x, _ := m[int64(-2)].([]byte)
		y, _ := m[int64(-3)].([]byte)
		if len(x) != 32 || len(y) != 32 {
			return nil, errPasskey
		}
		pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), append([]byte{4}, append(x, y...)...))
		if err != nil {
			return nil, errPasskey
		}
		return x509.MarshalPKIXPublicKey(pub)
	case kty == 3 && alg == -257:
		n, _ := m[int64(-1)].([]byte)
		e, _ := m[int64(-2)].([]byte)
		if len(n) < 256 || len(n) > 1024 || len(e) == 0 || len(e) > 4 {
			return nil, errPasskey
		}
		exp := 0
		for _, c := range e {
			exp = exp<<8 | int(c)
		}
		if exp < 3 {
			return nil, errPasskey
		}
		return x509.MarshalPKIXPublicKey(&rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exp})
	}
	return nil, errPasskey
}

func verifySignature(der, signed, sig []byte) bool {
	pub, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return false
	}
	digest := sha256.Sum256(signed)
	switch k := pub.(type) {
	case *ecdsa.PublicKey:
		return ecdsa.VerifyASN1(k, digest[:], sig)
	case *rsa.PublicKey:
		return rsa.VerifyPKCS1v15(k, crypto.SHA256, digest[:], sig) == nil
	}
	return false
}

func (a *App) mountPasskeys(rt *Router) {
	rt.Handle("GET", "/passkeys", a.authed(nil, a.listPasskeys))
	rt.Handle("POST", "/passkeys/options", a.authed(nil, a.passkeyRegisterOptions))
	rt.Handle("POST", "/passkeys", a.authed(nil, a.passkeyRegister))
	rt.Handle("DELETE", "/passkeys/{pid}", a.authed(nil, a.deletePasskey))
	rt.Handle("POST", "/auth/passkey/options", a.handle(a.passkeyLoginOptions))
	rt.Handle("POST", "/auth/passkey", a.handle(a.passkeyLogin))
}

type passkeyDTO struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"created_at"`
	LastUsedAt string `json:"last_used_at"`
}

func iso(unix int64) string {
	if unix == 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format(time.RFC3339)
}

func (a *App) listPasskeys(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	rows, err := a.Store.R.QueryContext(r.Context(), "SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id", p.User.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []passkeyDTO{}
	for rows.Next() {
		var d passkeyDTO
		var created, used int64
		if err := rows.Scan(&d.ID, &d.Name, &created, &used); err != nil {
			return err
		}
		d.CreatedAt, d.LastUsedAt = iso(created), iso(used)
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (a *App) passkeyRegisterOptions(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	rpID, _, err := a.relyingParty(r)
	if err != nil {
		return err
	}
	id, challenge, err := a.challenges.issue("register", p.User.ID, a.Trusted.ClientIP(r), a.now())
	if err != nil {
		return err
	}
	exclude := []map[string]string{}
	rows, err := a.Store.R.QueryContext(r.Context(), "SELECT credential_id FROM passkeys WHERE user_id = ?", p.User.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid string
		if err := rows.Scan(&cid); err != nil {
			return err
		}
		exclude = append(exclude, map[string]string{"type": "public-key", "id": cid})
	}
	display := p.User.FullName
	if display == "" {
		display = p.User.Login
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"challenge_id": id,
		"public_key": map[string]any{
			"challenge": b64.EncodeToString(challenge),
			"rp":        map[string]string{"id": rpID, "name": "Легкий звіт"},
			"user":      map[string]string{"id": b64.EncodeToString(userHandle(p.User.ID)), "name": p.User.Login, "displayName": display},
			"pubKeyCredParams": []map[string]any{
				{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -257},
			},
			"timeout":     int(challengeTTL / time.Millisecond),
			"attestation": "none",
			"authenticatorSelection": map[string]any{
				"residentKey": "required", "requireResidentKey": true, "userVerification": "required",
			},
			"excludeCredentials": exclude,
		},
	})
	return nil
}

func (a *App) passkeyRegister(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	challengeID := body.String("challenge_id", 1, 200)
	name := strings.TrimSpace(body.String("name", 0, 60))
	credID := body.String("id", 1, 1400)
	clientJSON := body.String("client_data_json", 1, 8192)
	attestation := body.String("attestation_object", 1, 16384)
	if err := body.Err(); err != nil {
		return err
	}
	bad := HTTPError{Status: 400, Detail: "Не вдалося зареєструвати ключ доступу. Спробуйте ще раз."}
	rpID, origin, err := a.relyingParty(r)
	if err != nil {
		return err
	}
	pc, ok := a.challenges.take(challengeID, "register", p.User.ID, a.now())
	if !ok {
		return bad
	}
	cdRaw, e1 := b64.DecodeString(clientJSON)
	attRaw, e2 := b64.DecodeString(attestation)
	rawID, e3 := b64.DecodeString(credID)
	if e1 != nil || e2 != nil || e3 != nil || checkClientData(cdRaw, "webauthn.create", pc.challenge, origin) != nil {
		return bad
	}
	obj, _, err := decodeCBOR(attRaw)
	m, isMap := obj.(map[any]any)
	raw, isBytes := m["authData"].([]byte)
	if err != nil || !isMap || !isBytes {
		return bad
	}
	ad, err := parseAuthData(raw, rpID, true)
	if err != nil || string(ad.credID) != string(rawID) {
		return bad
	}
	der, err := coseToPublicKey(ad.key)
	if err != nil {
		return bad
	}
	if name == "" {
		name = "Ключ доступу"
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow("SELECT COUNT(*) FROM passkeys WHERE user_id = ?", p.User.ID).Scan(&n); err != nil {
			return err
		}
		if n >= maxPasskeysPerUser {
			return HTTPError{Status: 400, Detail: "Досягнуто ліміт ключів доступу. Видаліть непотрібний."}
		}
		if _, err := tx.Exec("INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			p.User.ID, b64.EncodeToString(ad.credID), der, ad.signCount, name, a.now().Unix()); err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				return bad
			}
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "додано ключ доступу", name)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, messageDTO{"Ключ доступу додано."})
	return nil
}

func (a *App) deletePasskey(w http.ResponseWriter, r *http.Request, p *platform.Principal) error {
	pid, err := strconv.ParseInt(Param(r, "pid"), 10, 64)
	if err != nil {
		return HTTPError{Status: 404, Detail: "Not Found"}
	}
	ip := a.Trusted.ClientIP(r)
	err = a.write(r.Context(), func(tx *sql.Tx) error {
		var name string
		if err := tx.QueryRow("SELECT name FROM passkeys WHERE id = ? AND user_id = ?", pid, p.User.ID).Scan(&name); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return HTTPError{Status: 404, Detail: "Not Found"}
			}
			return err
		}
		if _, err := tx.Exec("DELETE FROM passkeys WHERE id = ?", pid); err != nil {
			return err
		}
		return platform.Audit(tx, a.now(), ip, p.User.Login, p.User.RoleLabel(), "видалено ключ доступу", name)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, messageDTO{"Ключ доступу видалено."})
	return nil
}

func (a *App) passkeyLoginOptions(w http.ResponseWriter, r *http.Request) error {
	rpID, _, err := a.relyingParty(r)
	if err != nil {
		return err
	}
	if wait := a.Limiter.RetryAfter(a.Trusted.ClientIP(r), passkeyLimiterKey(a.Trusted.ClientIP(r))); wait > 0 {
		return HTTPError{Status: 429, Detail: "Забагато невдалих спроб. Спробуйте пізніше.",
			Headers: map[string]string{"Retry-After": strconv.Itoa(wait), "Cache-Control": "no-store"}}
	}
	id, challenge, err := a.challenges.issue("login", 0, a.Trusted.ClientIP(r), a.now())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"challenge_id": id,
		"public_key": map[string]any{
			"challenge":        b64.EncodeToString(challenge),
			"rpId":             rpID,
			"timeout":          int(challengeTTL / time.Millisecond),
			"userVerification": "required",
			"allowCredentials": []any{},
		},
	})
	return nil
}

func (a *App) passkeyLogin(w http.ResponseWriter, r *http.Request) error {
	body, err := ReadBody(r)
	if err != nil {
		return err
	}
	challengeID := body.String("challenge_id", 1, 200)
	credID := body.String("id", 1, 1400)
	clientJSON := body.String("client_data_json", 1, 8192)
	authB64 := body.String("authenticator_data", 1, 4096)
	sigB64 := body.String("signature", 1, 4096)
	if err := body.Err(); err != nil {
		return err
	}
	ip := a.Trusted.ClientIP(r)
	if wait := a.Limiter.RetryAfter(ip, passkeyLimiterKey(ip)); wait > 0 {
		return HTTPError{Status: 429, Detail: "Забагато невдалих спроб. Спробуйте пізніше.",
			Headers: map[string]string{"Retry-After": strconv.Itoa(wait), "Cache-Control": "no-store"}}
	}
	fail := func(login, role, why string) error {
		a.Limiter.RecordFailure(ip, passkeyLimiterKey(ip))
		if login == "" {
			login = "?"
		}
		if err := a.audit(r, ip, login, role, "невдалий вхід", why); err != nil {
			return err
		}
		return HTTPError{Status: 401, Detail: "Не вдалося увійти за ключем доступу."}
	}
	rpID, origin, err := a.relyingParty(r)
	if err != nil {
		return err
	}
	pc, ok := a.challenges.take(challengeID, "login", 0, a.now())
	cdRaw, e1 := b64.DecodeString(clientJSON)
	adRaw, e2 := b64.DecodeString(authB64)
	sig, e3 := b64.DecodeString(sigB64)
	if !ok || e1 != nil || e2 != nil || e3 != nil || checkClientData(cdRaw, "webauthn.get", pc.challenge, origin) != nil {
		return fail("", "", "ключ доступу")
	}
	var (
		pkID, uid int64
		der       []byte
		stored    uint32
	)
	err = a.Store.R.QueryRowContext(r.Context(), "SELECT id, user_id, public_key, sign_count FROM passkeys WHERE credential_id = ?", credID).
		Scan(&pkID, &uid, &der, &stored)
	if errors.Is(err, sql.ErrNoRows) {
		return fail("", "", "ключ доступу: невідомий")
	}
	if err != nil {
		return err
	}
	user, err := platform.LoadUserByID(r.Context(), a.Store.R, uid)
	if err != nil {
		return err
	}
	if user == nil {
		return fail("", "", "ключ доступу: невідомий")
	}
	ad, err := parseAuthData(adRaw, rpID, false)
	cdHash := sha256.Sum256(cdRaw)
	if err != nil || !verifySignature(der, append(append([]byte(nil), adRaw...), cdHash[:]...), sig) {
		return fail(user.Login, user.RoleLabel(), "ключ доступу: підпис")
	}
	if (stored != 0 || ad.signCount != 0) && ad.signCount <= stored {
		return fail(user.Login, user.RoleLabel(), "ключ доступу: лічильник (можлива копія)")
	}
	if !user.CanSignIn() {
		reason := "обліковий запис вимкнено"
		if user.Active {
			reason = "організація в архіві"
		}
		if err := a.audit(r, ip, user.Login, user.RoleLabel(), "невдалий вхід", reason); err != nil {
			return err
		}
		return HTTPError{Status: 403, Detail: "Цей обліковий запис вимкнено. Зверніться до адміністратора."}
	}
	a.Limiter.Clear(ip, passkeyLimiterKey(ip))
	var token, device string
	if err := a.write(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.Exec("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?", ad.signCount, a.now().Unix(), pkID); err != nil {
			return err
		}
		if err := platform.Audit(tx, a.now(), ip, user.Login, user.RoleLabel(), "вхід", "ключ доступу"); err != nil {
			return err
		}
		var err error
		token, device, err = startSession(tx, user.ID, a.now(), a.metaOf(r))
		return err
	}); err != nil {
		return err
	}
	SessionFrom(r).Start(user.ID, token, device)
	p, err := platform.PrincipalFor(r.Context(), a.Store.R, user, a.Registry.Codes)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, a.sessionDTO(p))
	return nil
}
