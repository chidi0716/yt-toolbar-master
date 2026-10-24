//go:build !windows

package main

import (
	"os"
	"runtime"
)

// isRoot 回傳是否在 macOS 上以 root 執行（安裝只限使用者層級，008 FR-12）。
// Linux 只供開發與測試，不檢查。
func isRoot() bool { return runtime.GOOS == "darwin" && os.Geteuid() == 0 }
