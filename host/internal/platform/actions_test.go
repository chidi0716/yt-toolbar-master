package platform

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
)

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestRevealCommand(t *testing.T) {
	c, err := RevealCommand("darwin", "/Users/me/Downloads/a b [x].mp4", env(nil))
	if err != nil || c.Path != "/usr/bin/open" || strings.Join(c.Args, "|") != "-R|/Users/me/Downloads/a b [x].mp4" {
		t.Fatalf("darwin: %+v %v", c, err)
	}
	c, err = RevealCommand("windows", `C:\Users\me\Downloads\a b.mp4`, env(map[string]string{"SystemRoot": `C:\WINDOWS`}))
	if err != nil || c.Path != `C:\WINDOWS\explorer.exe` || c.CmdLine != `"C:\WINDOWS\explorer.exe" /select,"C:\Users\me\Downloads\a b.mp4"` {
		t.Fatalf("windows: %+v %v", c, err)
	}
	if _, err := RevealCommand("windows", `C:\a"b.mp4`, env(nil)); err == nil {
		t.Error("quote in path must be rejected")
	}
	if _, err := RevealCommand("linux", "/x", env(nil)); errs.From(err).Code != errs.UnsupportedPlatform {
		t.Errorf("linux: %v", err)
	}
}

func decodePS(t *testing.T, s string) string {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return string(utf16.Decode(u))
}

func TestPickFolderCommand(t *testing.T) {
	c, err := PickFolderCommand("darwin", env(nil))
	if err != nil || c.Path != "/usr/bin/osascript" || len(c.Args) != 4 || c.Args[0] != "-e" ||
		!strings.Contains(c.Args[3], "choose folder") {
		t.Fatalf("darwin: %+v %v", c, err)
	}
	c, err = PickFolderCommand("windows", env(nil))
	if err != nil || c.Path != `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` {
		t.Fatalf("windows: %+v %v", c, err)
	}
	args := strings.Join(c.Args[:4], " ")
	if args != "-NoProfile -NonInteractive -STA -EncodedCommand" {
		t.Errorf("windows args: %s", args)
	}
	if got := decodePS(t, c.Args[4]); got != winPickFolderScript {
		t.Errorf("encoded script does not round-trip")
	}
	if _, err := PickFolderCommand("linux", env(nil)); errs.From(err).Code != errs.UnsupportedPlatform {
		t.Errorf("linux: %v", err)
	}
}

func TestParsePickFolder(t *testing.T) {
	r, err := ParsePickFolder("darwin", "/Users/me/Movies/YouTube/\n", "", nil)
	if err != nil || r.Cancelled || *r.Path != "/Users/me/Movies/YouTube" {
		t.Fatalf("darwin ok: %+v %v", r, err)
	}
	r, err = ParsePickFolder("darwin", "", "execution error: User canceled. (-128)", errors.New("exit status 1"))
	if err != nil || !r.Cancelled || r.Path != nil {
		t.Fatalf("darwin cancel: %+v %v", r, err)
	}
	if _, err := ParsePickFolder("darwin", "", "execution error: something else (-1700)", errors.New("exit status 1")); err == nil {
		t.Fatal("other osascript errors must be reported")
	}
	r, err = ParsePickFolder("windows", "\uFEFFD:\\影片\r\n", "", nil)
	if err != nil || *r.Path != `D:\影片` {
		t.Fatalf("windows ok: %+v %v", r, err)
	}
	r, err = ParsePickFolder("windows", "", "", nil)
	if err != nil || !r.Cancelled {
		t.Fatalf("windows cancel: %+v %v", r, err)
	}
	if _, err := ParsePickFolder("windows", "relative\\path", "", nil); err == nil {
		t.Fatal("relative path must be rejected")
	}
}

func TestActionsOnUnsupportedOrMissing(t *testing.T) {
	a := &Actions{GOOS: runtime.GOOS, Getenv: env(nil)}
	if err := a.Reveal(context.Background(), filepath.Join(t.TempDir(), "missing.mp4")); errs.From(err).Code != errs.FileNotFound {
		t.Errorf("missing file: %v", err)
	}
	if runtime.GOOS == "linux" {
		if _, err := a.PickFolder(context.Background()); errs.From(err).Code != errs.UnsupportedPlatform {
			t.Errorf("linux pickFolder: %v", err)
		}
	}
}
