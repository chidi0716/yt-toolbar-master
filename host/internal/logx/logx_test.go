package logx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func TestLoggerRotationAndSanitize(t *testing.T) {
	dir := t.TempDir()
	l := New(dir, "host")
	l.home = "/Users/alice"
	l.max = 400
	l.Printf("download: ok %s", "/Users/alice/Downloads/x.mp4")
	l.Printf("ERROR: Cookie: SID=abc123; token=xyz Authorization: Bearer s3cret\nnext line")
	b, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, bad := range []string{"alice", "abc123", "xyz", "s3cret"} {
		if strings.Contains(s, bad) {
			t.Errorf("log contains %q:\n%s", bad, s)
		}
	}
	if !strings.Contains(s, "~/Downloads/x.mp4") || strings.Count(s, "\n") != 2 {
		t.Errorf("unexpected log:\n%s", s)
	}
	for i := 0; i < 20; i++ {
		l.Printf("line %d", i)
	}
	st, err := os.Stat(filepath.Join(dir, FileName))
	if err != nil || st.Size() > 400 {
		t.Fatalf("log not rotated: %v %v", st.Size(), err)
	}
	if _, err := os.Stat(filepath.Join(dir, FileName+".1")); err != nil {
		t.Fatalf("no rotated file: %v", err)
	}
	var nilLogger *Logger
	nilLogger.Printf("must not panic")
}
