//go:build windows

package main

// isRoot 在 Windows 上一律為 false：以系統管理員身分（同一個使用者）執行時，
// HKCU 與 %LOCALAPPDATA% 仍是這個使用者的位置，不影響安裝結果。
func isRoot() bool { return false }
