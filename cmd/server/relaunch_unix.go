//go:build !windows

package main

import (
	"os"
	"syscall"
)

// relaunchProgram replaces this process with the (updated) program at exe, same arguments and environment.
func relaunchProgram(exe string) error {
	env := append(os.Environ(), "LEGKYI_RESTARTED=1")
	return syscall.Exec(exe, os.Args, env)
}
