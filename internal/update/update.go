// Package update replaces the running program with the newest GitHub release: it asks the Releases API what
// the latest release is, downloads the asset for this platform, checks it against the release's SHA256SUMS.txt,
// swaps the file in place and asks main to restart. Builds without a version stamp (go run, Docker, tests)
// never update.
package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Set by the release build: -ldflags "-X legkyi/internal/update.Tag=... -X ...Commit=... -X ...BuiltAt=...".
var (
	Tag     string // release tag this build was published as; empty = not a release build
	Commit  string // full git SHA
	BuiltAt string // RFC 3339
)

const (
	DefaultRepo   = "alsesd/easymourningreport"
	DefaultAPI    = "https://api.github.com"
	maxBinaryByte = 250 << 20
	sumsAsset     = "SHA256SUMS.txt"
	userAgent     = "legkyi-updater"
)

// Build is what a running program knows about itself.
type Build struct {
	Tag, Commit string
	BuiltAt     time.Time
}

// Current reads the stamped values.
func Current() Build {
	b := Build{Tag: Tag, Commit: Commit}
	b.BuiltAt, _ = time.Parse(time.RFC3339, BuiltAt)
	return b
}

// Status is the JSON shape of GET /admin/update.
type Status struct {
	Enabled     bool    `json:"enabled"`   // this build can update (release build, supported platform)
	Auto        bool    `json:"auto"`      // applies updates by itself
	Current     string  `json:"current"`   // tag of the running build ("" = development build)
	Latest      string  `json:"latest"`    // tag of the newest release seen
	Available   bool    `json:"available"` // Latest is newer than Current
	State       string  `json:"state"`     // idle, checking, downloading, restarting, error
	LastChecked *string `json:"last_checked"`
	Error       string  `json:"error"`
	Writable    bool    `json:"writable"` // the program's folder accepts the new file
}

type release struct {
	TagName         string    `json:"tag_name"`
	TargetCommitish string    `json:"target_commitish"`
	PublishedAt     time.Time `json:"published_at"`
	Draft           bool      `json:"draft"`
	Prerelease      bool      `json:"prerelease"`
	Assets          []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
		Size int64  `json:"size"`
	} `json:"assets"`
}

// Updater holds the update state of one program.
type Updater struct {
	Repo, API string
	Client    *http.Client
	Exe       string // path of the running program
	Build     Build
	GOOS      string
	GOARCH    string
	Auto      bool
	// Backup is called before the file is replaced. A failure stops the update.
	Backup func() error
	// Restart is closed-over by main: it must start a graceful shutdown that ends in relaunching Exe.
	Restart func()
	Now     func() time.Time
	// AllowHTTP lets tests use a plain http fake of GitHub.
	AllowHTTP bool

	mu      sync.Mutex
	latest  release
	state   string
	checked time.Time
	lastErr string
	busy    bool
}

func (u *Updater) now() time.Time {
	if u.Now != nil {
		return u.Now()
	}
	return time.Now()
}

func (u *Updater) goos() string {
	if u.GOOS != "" {
		return u.GOOS
	}
	return runtime.GOOS
}

func (u *Updater) goarch() string {
	if u.GOARCH != "" {
		return u.GOARCH
	}
	return runtime.GOARCH
}

// AssetName is the release file for this platform ("" = no build for it).
func AssetName(goos, goarch string) string {
	switch goos + "/" + goarch {
	case "windows/amd64":
		return "legkyi.exe"
	case "linux/amd64":
		return "legkyi"
	case "linux/arm64":
		return "legkyi-linux-arm64"
	}
	return ""
}

// Enabled: a release build on a platform with a release file.
func (u *Updater) Enabled() bool {
	return u.Build.Tag != "" && u.Exe != "" && AssetName(u.goos(), u.goarch()) != ""
}

func (u *Updater) client() *http.Client {
	if u.Client != nil {
		return u.Client
	}
	return &http.Client{Timeout: 10 * time.Minute}
}

func (u *Updater) get(ctx context.Context, rawURL string, limit int64) (*http.Response, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "https" && !(u.AllowHTTP && parsed.Scheme == "http")) {
		return nil, fmt.Errorf("refusing a non-https address: %s", rawURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/vnd.github+json")
	c := *u.client()
	c.CheckRedirect = func(r *http.Request, via []*http.Request) error {
		if len(via) > 5 || (r.URL.Scheme != "https" && !u.AllowHTTP) {
			return errors.New("refusing a redirect to a non-https address")
		}
		return nil
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("%s answered %d", parsed.Host, resp.StatusCode)
	}
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.LimitReader(resp.Body, limit+1), resp.Body}
	return resp, nil
}

// newer: the release is not the running one and was published after this build was made. Tags are free text
// ("Soup.V6", "auto-12"), so they are never compared with each other.
func (u *Updater) newer(r release) bool {
	if r.TagName == "" || r.TagName == u.Build.Tag || r.Draft || r.Prerelease {
		return false
	}
	if u.Build.Commit != "" && r.TargetCommitish == u.Build.Commit {
		return false
	}
	return u.Build.BuiltAt.IsZero() || r.PublishedAt.After(u.Build.BuiltAt)
}

// Check asks GitHub for the latest release and remembers the answer.
func (u *Updater) Check(ctx context.Context) Status {
	u.mu.Lock()
	if u.busy {
		u.mu.Unlock()
		return u.Status()
	}
	u.busy, u.state = true, "checking"
	u.mu.Unlock()

	rel, err := u.fetchLatest(ctx)

	u.mu.Lock()
	u.busy, u.checked = false, u.now()
	if err != nil {
		u.state, u.lastErr = "error", err.Error()
	} else {
		u.state, u.lastErr, u.latest = "idle", "", rel
	}
	u.mu.Unlock()
	return u.Status()
}

func (u *Updater) fetchLatest(ctx context.Context) (release, error) {
	repo, api := u.Repo, u.API
	if repo == "" {
		repo = DefaultRepo
	}
	if api == "" {
		api = DefaultAPI
	}
	resp, err := u.get(ctx, api+"/repos/"+repo+"/releases/latest", 1<<20)
	if err != nil {
		return release{}, err
	}
	defer resp.Body.Close()
	var rel release
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return release{}, fmt.Errorf("unreadable release answer: %w", err)
	}
	return rel, nil
}

// Status never blocks on the network.
func (u *Updater) Status() Status {
	u.mu.Lock()
	defer u.mu.Unlock()
	s := Status{Enabled: u.Enabled(), Auto: u.Auto && u.Enabled(), Current: u.Build.Tag, Latest: u.latest.TagName,
		Available: u.newer(u.latest), State: u.state, Error: u.lastErr, Writable: u.writable()}
	if s.State == "" {
		s.State = "idle"
	}
	if !u.checked.IsZero() {
		t := u.checked.UTC().Format("2006-01-02T15:04:05Z")
		s.LastChecked = &t
	}
	return s
}

func (u *Updater) writable() bool {
	if u.Exe == "" {
		return false
	}
	f, err := os.CreateTemp(filepath.Dir(u.Exe), ".legkyi-write-test-*")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

// begin claims the updater for one install and returns the release to install.
func (u *Updater) begin() (release, error) {
	if !u.Enabled() {
		return release{}, errors.New("цей екземпляр не є релізною збіркою, оновлення вимкнено")
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.busy {
		return release{}, errors.New("оновлення вже виконується")
	}
	if !u.newer(u.latest) {
		return release{}, errors.New("новішої версії немає")
	}
	u.busy, u.state, u.lastErr = true, "downloading", ""
	return u.latest, nil
}

func (u *Updater) run(ctx context.Context, rel release) error {
	err := u.install(ctx, rel)
	u.mu.Lock()
	u.busy = false
	if err != nil {
		u.state, u.lastErr = "error", err.Error()
	} else {
		u.state = "restarting"
	}
	u.mu.Unlock()
	if err == nil && u.Restart != nil {
		u.Restart()
	}
	return err
}

// Apply downloads and installs the newest release (the one the last Check saw), then asks main to restart.
// It returns when the file is in place.
func (u *Updater) Apply(ctx context.Context) error {
	rel, err := u.begin()
	if err != nil {
		return err
	}
	return u.run(ctx, rel)
}

// Start is Apply in the background: it returns at once, the progress is in Status. The admin page uses it
// because a download through the tunnel can outlast the edge's request timeout.
func (u *Updater) Start() error {
	rel, err := u.begin()
	if err != nil {
		return err
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		_ = u.run(ctx, rel)
	}()
	return nil
}

func (u *Updater) install(ctx context.Context, rel release) error {
	want := AssetName(u.goos(), u.goarch())
	var binURL, sumsURL string
	var size int64
	for _, a := range rel.Assets {
		switch a.Name {
		case want:
			binURL, size = a.URL, a.Size
		case sumsAsset:
			sumsURL = a.URL
		}
	}
	if binURL == "" || sumsURL == "" {
		return fmt.Errorf("у релізі %s немає файлів %s та %s", rel.TagName, want, sumsAsset)
	}
	if size > maxBinaryByte {
		return errors.New("файл оновлення завеликий")
	}
	sums, err := u.download(ctx, sumsURL, 1<<20)
	if err != nil {
		return err
	}
	wantSum := checksumFor(string(sums), want)
	if wantSum == "" {
		return fmt.Errorf("у %s немає суми для %s", sumsAsset, want)
	}
	dir := filepath.Dir(u.Exe)
	tmp, err := os.CreateTemp(dir, ".legkyi-update-*")
	if err != nil {
		return fmt.Errorf("немає доступу до запису в теку програми: %w", err)
	}
	defer os.Remove(tmp.Name()) // gone after a successful rename, cleans up after a failure
	resp, err := u.get(ctx, binURL, maxBinaryByte)
	if err != nil {
		tmp.Close()
		return err
	}
	defer resp.Body.Close()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), resp.Body)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if n > maxBinaryByte || n == 0 {
		return errors.New("файл оновлення має недопустимий розмір")
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != wantSum {
		return errors.New("контрольна сума завантаженого файлу не збігається, оновлення скасовано")
	}
	if err := os.Chmod(tmp.Name(), 0o755); err != nil {
		return err
	}
	if u.Backup != nil {
		if err := u.Backup(); err != nil {
			return fmt.Errorf("не вдалося створити резервну копію перед оновленням: %w", err)
		}
	}
	return Swap(u.Exe, tmp.Name(), u.goos())
}

func (u *Updater) download(ctx context.Context, rawURL string, limit int64) ([]byte, error) {
	resp, err := u.get(ctx, rawURL, limit)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, errors.New("відповідь завелика")
	}
	return b, nil
}

// checksumFor finds the hash of name in `sha256sum` output ("<hex>  <name>" or "<hex> *<name>").
func checksumFor(sums, name string) string {
	for _, line := range strings.Split(sums, "\n") {
		f := strings.Fields(strings.TrimSpace(line))
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name && len(f[0]) == 64 {
			return strings.ToLower(f[0])
		}
	}
	return ""
}

// Swap puts newFile in place of exe and keeps the previous program as <exe>.old for a manual rollback until the
// next update replaces it. Linux replaces the file atomically (the running process keeps the old inode);
// Windows cannot overwrite a running exe, so it is renamed first.
func Swap(exe, newFile, goos string) error {
	old := exe + ".old"
	_ = os.Remove(old)
	if goos != "windows" {
		_ = os.Link(exe, old) // keep the previous program for a manual rollback (best effort: not every filesystem links)
		return os.Rename(newFile, exe)
	}
	if err := os.Rename(exe, old); err != nil {
		return err
	}
	if err := os.Rename(newFile, exe); err != nil {
		_ = os.Rename(old, exe) // put the working program back
		return err
	}
	return nil
}

// Loop checks for updates after first and then every every, applying them when Auto is set, until ctx ends.
func (u *Updater) Loop(ctx context.Context, first, every time.Duration) {
	if !u.Enabled() {
		return
	}
	wait := first
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = every
		if st := u.Check(ctx); st.Available && u.Auto {
			_ = u.Apply(ctx) // the error is kept in the status
		}
	}
}
