//go:build !darwin

package platform

// ClearQuarantine 只在 macOS 上有作用（008 FR-15b）。
func ClearQuarantine(root string) {}
