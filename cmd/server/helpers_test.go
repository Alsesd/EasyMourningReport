package main

import (
	"net"
	"testing"
	"time"
)

func TestEnvHelpers(t *testing.T) {
	t.Setenv("FLAG_A", "off")
	t.Setenv("FLAG_B", "yes")
	t.Setenv("FLAG_C", "maybe")
	if boolEnv("FLAG_A", true) || !boolEnv("FLAG_B", false) || !boolEnv("FLAG_C", true) || boolEnv("FLAG_UNSET", false) {
		t.Fatal("boolEnv")
	}
	t.Setenv("NUM", " 12 ")
	t.Setenv("NUM_BAD", "x")
	if atoiEnv("NUM", 1) != 12 || atoiEnv("NUM_BAD", 7) != 7 || atoiEnv("NUM_UNSET", 3) != 3 {
		t.Fatal("atoiEnv")
	}
	t.Setenv("VAL", "v")
	if orEnv("VAL", "d") != "v" || orEnv("VAL_UNSET", "d") != "d" {
		t.Fatal("orEnv")
	}
}

func TestListenRetriesWhileThePreviousProcessClosesItsPort(t *testing.T) {
	first, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := first.Addr().String()
	if _, err := listen(addr, false); err == nil {
		t.Fatal("a busy port fails at once without retry")
	}
	go func() { time.Sleep(400 * time.Millisecond); first.Close() }()
	ln, err := listen(addr, true)
	if err != nil {
		t.Fatalf("the retry must succeed once the port is free: %v", err)
	}
	ln.Close()
}
