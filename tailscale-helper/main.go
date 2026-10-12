// Copyright (c) Alsesd

// tailscale-helper runs the app-specific Tailscale node. It is intentionally
// separate from the Python process so the app does not need the system
// Tailscale daemon or elevated privileges.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

type status struct {
	State     string `json:"state"`
	PublicURL string `json:"public_url,omitempty"`
	LoginURL  string `json:"login_url,omitempty"`
	Error     string `json:"error,omitempty"`
	UpdatedAt string `json:"updated_at"`
}

type statusWriter struct {
	mu   sync.Mutex
	path string
	data status
}

func newStatusWriter(path string) *statusWriter {
	return &statusWriter{path: path, data: status{State: "starting"}}
}

func (w *statusWriter) update(change func(*status)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	change(&w.data)
	w.data.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := os.MkdirAll(filepath.Dir(w.path), 0o700); err != nil {
		log.Printf("cannot create status directory: %v", err)
		return
	}
	payload, err := json.MarshalIndent(w.data, "", "  ")
	if err != nil {
		log.Printf("cannot encode status: %v", err)
		return
	}
	tmp := w.path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		log.Printf("cannot write status: %v", err)
		return
	}
	// Windows does not replace an existing file with os.Rename. Remove the
	// previous snapshot first; status is noncritical and can be regenerated.
	_ = os.Remove(w.path)
	if err := os.Rename(tmp, w.path); err != nil {
		_ = os.Remove(tmp)
		log.Printf("cannot replace status: %v", err)
	}
}

func main() {
	stateDir := flag.String("state-dir", "", "private directory for this app's Tailscale identity")
	statusPath := flag.String("status-file", "", "status JSON file written for the app UI")
	target := flag.String("target", "http://127.0.0.1:8000", "local application URL")
	authKeyStdin := flag.Bool("auth-key-stdin", false, "read the optional auth key from stdin")
	flag.Parse()

	if *stateDir == "" || *statusPath == "" {
		log.Fatal("--state-dir and --status-file are required")
	}
	if err := os.MkdirAll(*stateDir, 0o700); err != nil {
		log.Fatalf("cannot create Tailscale state directory: %v", err)
	}
	targetURL, err := url.Parse(*target)
	if err != nil || targetURL.Scheme != "http" || targetURL.Host == "" {
		log.Fatal("--target must be an http:// URL with a host")
	}

	authKey := ""
	if *authKeyStdin {
		line, readErr := bufio.NewReader(os.Stdin).ReadString('\n')
		if readErr != nil && len(line) == 0 {
			log.Fatalf("cannot read optional auth key from stdin: %v", readErr)
		}
		authKey = strings.TrimSpace(line)
	}

	state := newStatusWriter(*statusPath)
	state.update(func(s *status) { s.State = "starting" })

	server := &tsnet.Server{
		Dir:      *stateDir,
		Hostname: "legkyi-zvit",
		AuthKey:  authKey,
		UserLogf: func(format string, args ...any) {
			message := fmt.Sprintf(format, args...)
			log.Print(message)
			if strings.Contains(message, "https://login.tailscale.com/") {
				start := strings.Index(message, "https://login.tailscale.com/")
				loginURL := strings.Fields(message[start:])[0]
				state.update(func(s *status) {
					s.State = "authentication-required"
					s.LoginURL = strings.TrimRight(loginURL, ".,)")
					s.Error = ""
				})
			}
		},
	}
	defer server.Close()

	listener, err := server.ListenFunnel("tcp", ":443", tsnet.FunnelOnly())
	if err != nil {
		state.update(func(s *status) {
			s.State = "error"
			s.Error = err.Error()
		})
		log.Printf("cannot enable Funnel: %v", err)
		os.Exit(1)
	}
	defer listener.Close()

	publicURL := ""
	domains := server.CertDomains()
	if len(domains) > 0 {
		publicURL = "https://" + domains[0]
	}
	state.update(func(s *status) {
		s.State = "running"
		s.PublicURL = publicURL
		s.Error = ""
	})

	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, proxyErr error) {
		log.Printf("local app proxy failed: %v", proxyErr)
		http.Error(w, "The local application is not ready yet.", http.StatusBadGateway)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Preserve the public host for the app's same-origin form protection.
		r.Header.Set("X-Forwarded-Proto", "https")
		proxy.ServeHTTP(w, r)
	})
	httpServer := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		state.update(func(s *status) {
			s.State = "error"
			s.Error = err.Error()
		})
		log.Printf("Funnel proxy stopped: %v", err)
		os.Exit(1)
	}
	state.update(func(s *status) { s.State = "stopped" })
}
