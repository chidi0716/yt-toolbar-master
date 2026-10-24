package platform

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWriteFileAtomic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "state.json")
	if err := WriteJSONAtomic(p, map[string]int{"a": 1}, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := WriteJSONAtomic(p, map[string]int{"a": 2}, 0o600); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "{\n  \"a\": 2\n}\n" {
		t.Errorf("content: %q", b)
	}
	if st, _ := os.Stat(p); runtime.GOOS != "windows" && st.Mode().Perm() != 0o600 {
		t.Errorf("mode: %v", st.Mode())
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Errorf("temporary files left: %v", entries)
	}
	if !IsFile(p) || IsFile(dir) || IsFile(filepath.Join(dir, "missing")) {
		t.Error("IsFile")
	}
	if err := WriteFileAtomic(filepath.Join(dir, "missing", "x"), nil, 0o644); err == nil {
		t.Error("expected an error for a missing folder")
	}
}
