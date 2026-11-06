package web

import (
	"sync"
	"time"
)

const (
	rlWindow = 15 * time.Minute
	rlPair   = 5  // failures per window for ip+login
	rlIP     = 20 // for ip
	rlLogin  = 30 // for login
)

// LoginLimiter is the in-memory sign-in throttle (core/ratelimit.py). Resets on restart.
type LoginLimiter struct {
	mu    sync.Mutex
	Now   func() time.Time
	fails map[string][]time.Time
}

func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{Now: time.Now, fails: map[string][]time.Time{}}
}

func keys(ip, login string) [3]string {
	return [3]string{"pair\x00" + ip + "\x00" + login, "ip\x00" + ip, "login\x00" + login}
}

var limits = [3]int{rlPair, rlIP, rlLogin}

func (l *LoginLimiter) recent(key string) []time.Time {
	cutoff := l.Now().Add(-rlWindow)
	q := l.fails[key]
	i := 0
	for i < len(q) && q[i].Before(cutoff) {
		i++
	}
	q = q[i:]
	l.fails[key] = q
	return q
}

// RetryAfter returns seconds until the next attempt is allowed (0 = allowed now).
func (l *LoginLimiter) RetryAfter(ip, login string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	wait := 0
	for i, k := range keys(ip, login) {
		q := l.recent(k)
		if len(q) >= limits[i] {
			w := int(q[0].Add(rlWindow).Sub(l.Now()).Seconds()) + 1
			if w > wait {
				wait = w
			}
		}
	}
	return wait
}

func (l *LoginLimiter) RecordFailure(ip, login string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	for _, k := range keys(ip, login) {
		l.fails[k] = append(l.fails[k], now)
	}
	if len(l.fails) > 5000 { // drop expired entries so random logins cannot grow memory forever
		for k := range l.fails {
			if len(l.recent(k)) == 0 {
				delete(l.fails, k)
			}
		}
	}
}

func (l *LoginLimiter) Clear(ip, login string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, keys(ip, login)[0])
}
