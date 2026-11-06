//go:build windows

package main

// restrictFiles is a no-op on Windows: access to the folder is governed by NTFS permissions (see docs/security.md).
func restrictFiles(dataDir, backupsDir string) {}
