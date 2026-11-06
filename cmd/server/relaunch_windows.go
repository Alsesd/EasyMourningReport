//go:build windows

package main

import (
	"os"
	"os/exec"
)

// relaunchProgram starts the (updated) program at exe in this console and lets this process exit.
// The new process retries the port for a few seconds while this one finishes closing.
func relaunchProgram(exe string) error {
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Env = append(os.Environ(), "LEGKYI_RESTARTED=1")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
