package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// fakeGitHub answers the two things the updater asks for, offering `binary` as a release published in the
// future (so it counts as newer than any build).
type fakeGitHub struct {
	url string
	srv *http.Server
}

func startFakeGitHub(binary []byte, asset string) (*fakeGitHub, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(binary)
	sums := hex.EncodeToString(sum[:]) + "  " + asset + "\n"
	f := &fakeGitHub{url: "http://" + ln.Addr().String()}
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "smoke-update", "target_commitish": "smoke", "published_at": time.Now().Add(time.Hour).UTC(),
			"assets": []map[string]any{
				{"name": asset, "browser_download_url": f.url + "/dl/binary", "size": len(binary)},
				{"name": "SHA256SUMS.txt", "browser_download_url": f.url + "/dl/sums", "size": len(sums)},
			},
		})
	})
	mux.HandleFunc("/dl/binary", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(binary) })
	mux.HandleFunc("/dl/sums", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(sums)) })
	f.srv = &http.Server{Handler: mux}
	go func() { _ = f.srv.Serve(ln) }()
	return f, nil
}

func (f *fakeGitHub) close() { _ = f.srv.Close() }

func post(client *http.Client, base, path string) (map[string]any, int, error) {
	req, _ := http.NewRequest("POST", base+path, bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out, resp.StatusCode, nil
}

// checkUpdate installs the offered release and verifies the whole chain. On Windows the first process ends
// by design and a replacement takes over, so the exit of cmd is not a failure here.
func checkUpdate(client *http.Client, base, dir, target string, cmd *exec.Cmd, logPath string) error {
	st, code, err := post(client, base, "/api/v1/admin/update/check")
	if err != nil || code != 200 {
		return fmt.Errorf("update check = %d %v %v (is this a stamped release build? build with LEGKYI_VERSION)", code, st, err)
	}
	if st["available"] != true {
		return fmt.Errorf("the fake release was not seen as newer: %v", st)
	}
	if _, code, err = post(client, base, "/api/v1/admin/update/apply"); err != nil || code != 200 {
		return fmt.Errorf("update apply = %d %v", code, err)
	}
	logHas := func(s string) bool { b, _ := os.ReadFile(logPath); return strings.Contains(string(b), s) }
	never := make(chan struct{})
	if err := waitFor(func() bool { return logHas("the program was updated; restarting") }, 90*time.Second, never); err != nil {
		return fmt.Errorf("the program never announced its restart: %w", err)
	}
	// Give the old process time to go away, then the replacement must answer on the same port.
	time.Sleep(1500 * time.Millisecond)
	if err := waitFor(func() bool { return get(base+"/healthz") == 200 }, 60*time.Second, never); err != nil {
		return fmt.Errorf("the program did not come back after the update: %w", err)
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "backups", "*before-update*")); len(m) == 0 {
		return fmt.Errorf("no before-update backup")
	}
	if runtime.GOOS == "windows" {
		if _, err := os.Stat(target + ".old"); err != nil {
			return fmt.Errorf("the previous exe was not kept as .old: %w", err)
		}
	}
	// The browser's cookies (session and device token) must still be accepted by the restarted program.
	sess, err := client.Get(base + "/api/v1/session")
	if err != nil || sess.StatusCode != 200 {
		return fmt.Errorf("the session did not survive the restart: %v", err)
	}
	sess.Body.Close()
	return nil
}

// killReplacement stops the program that took over after an update on Windows.
func killReplacement(image string) error {
	if err := exec.Command("taskkill", "/F", "/T", "/IM", image).Run(); err != nil {
		return fmt.Errorf("could not stop the replacement process: %w", err)
	}
	return nil
}
