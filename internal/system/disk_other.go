//go:build !windows

package system

import "syscall"

// FreeDisk reports the free and total bytes of the disk holding path (ok false when it cannot be read).
func FreeDisk(path string) (free, total uint64, ok bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, false
	}
	return uint64(st.Bavail) * uint64(st.Bsize), uint64(st.Blocks) * uint64(st.Bsize), true
}
