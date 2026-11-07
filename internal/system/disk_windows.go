//go:build windows

package system

import "golang.org/x/sys/windows"

// FreeDisk reports the free and total bytes of the disk holding path (ok false when it cannot be read).
func FreeDisk(path string) (free, total uint64, ok bool) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, false
	}
	var avail, all, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(p, &avail, &all, &totalFree); err != nil {
		return 0, 0, false
	}
	return avail, all, true
}
