//go:build !windows

package system

import "os/exec"

// bindToLifetime is a no-op outside Windows (the supervisor stops the child on shutdown).
func bindToLifetime(*exec.Cmd) {}
