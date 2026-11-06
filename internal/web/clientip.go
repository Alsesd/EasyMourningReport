package web

import (
	"net"
	"net/http"
	"strconv"
	"strings"
)

// TrustedHosts ports uvicorn's ProxyHeadersMiddleware trust rules (uvicorn 0.54):
// X-Forwarded-For is honoured only when the direct peer is trusted, and the client is the
// right-most address in the header that is not itself trusted.
type TrustedHosts struct {
	always   bool
	hosts    []net.IP
	networks []*net.IPNet
	literals map[string]bool
}

func ParseTrustedHosts(spec string) *TrustedHosts {
	t := &TrustedHosts{literals: map[string]bool{}}
	if strings.TrimSpace(spec) == "*" {
		t.always = true
		return t
	}
	for _, h := range strings.Split(spec, ",") {
		h = strings.TrimSpace(h)
		if strings.Contains(h, "/") {
			if _, n, err := net.ParseCIDR(h); err == nil {
				t.networks = append(t.networks, n)
				continue
			}
			t.literals[h] = true
		} else if ip := net.ParseIP(h); ip != nil {
			t.hosts = append(t.hosts, ip)
		} else {
			t.literals[h] = true
		}
	}
	return t
}

func (t *TrustedHosts) Trusts(host string) bool {
	if t.always {
		return true
	}
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		for _, h := range t.hosts {
			if h.Equal(ip) {
				return true
			}
		}
		for _, n := range t.networks {
			if n.Contains(ip) {
				return true
			}
		}
		return false
	}
	return t.literals[host]
}

func parseHostPort(v string) (string, int) {
	if strings.HasPrefix(v, "[") {
		end := strings.Index(v, "]")
		if end == -1 {
			return v, 0
		}
		host, rest := v[1:end], v[end+1:]
		if rest == "" {
			return host, 0
		}
		if !strings.HasPrefix(rest, ":") {
			return v, 0
		}
		n, err := strconv.Atoi(rest[1:])
		if err != nil {
			return host, 0
		}
		return host, n
	}
	if strings.Count(v, ":") == 1 {
		i := strings.LastIndex(v, ":")
		n, err := strconv.Atoi(v[i+1:])
		if err != nil {
			return v, 0
		}
		return v[:i], n
	}
	return v, 0
}

func (t *TrustedHosts) clientFromXFF(xff string) string {
	var hosts []string
	for _, h := range strings.Split(xff, ",") {
		hosts = append(hosts, strings.TrimSpace(h))
	}
	if t.always {
		h, _ := parseHostPort(hosts[0])
		return h
	}
	for i := len(hosts) - 1; i >= 0; i-- {
		h, _ := parseHostPort(hosts[i])
		if !t.Trusts(h) {
			return h
		}
	}
	h, _ := parseHostPort(hosts[0])
	return h
}

// ClientIP is the caller's address as the Python app saw it (request.client.host).
func (t *TrustedHosts) ClientIP(r *http.Request) string {
	peer := r.RemoteAddr
	if h, _, err := net.SplitHostPort(peer); err == nil {
		peer = h
	}
	if t != nil && t.Trusts(peer) {
		if vals := r.Header.Values("X-Forwarded-For"); len(vals) > 0 {
			if h := t.clientFromXFF(strings.Join(vals, ", ")); h != "" {
				return h
			}
		}
	}
	if peer == "" {
		return "?"
	}
	return peer
}
