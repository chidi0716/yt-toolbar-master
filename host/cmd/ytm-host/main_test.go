package main

import (
	"os"
	"testing"
	"time"
)

// TestUninstallArgs 確認 --uninstall 只接受 --wait-pid <PID>（不合法時不刪除任何東西）。
func TestUninstallArgs(t *testing.T) {
	for _, args := range [][]string{{"--wait-pid"}, {"--wait-pid", "x"}, {"--wait-pid", "0"}, {"--delay", "2"}, {"--wait-pid", "1", "2"}} {
		if got := runUninstall(args); got != 2 {
			t.Errorf("%v: exit %d", args, got)
		}
	}
}

func TestWaitForExit(t *testing.T) {
	start := time.Now()
	waitForExit(0, time.Minute)
	waitForExit(999999999, time.Minute)
	if time.Since(start) > time.Second {
		t.Error("waited for a process that is not running")
	}
	start = time.Now()
	waitForExit(os.Getpid(), 300*time.Millisecond)
	if d := time.Since(start); d < 300*time.Millisecond || d > 5*time.Second {
		t.Errorf("waited %s for a running process", d)
	}
}

func TestIdentifyCaller(t *testing.T) {
	cases := []struct {
		args []string
		want string
		ok   bool
	}{
		{[]string{"chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/"}, "chrome", true},
		{[]string{"chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/", "--parent-window=1234"}, "chrome", true},
		{[]string{"/Users/me/Library/Application Support/Mozilla/NativeMessagingHosts/com.chidi0716.yt_toolbar_master.json", "yt-toolbar-master@chidi0716"}, "firefox", true},
		{nil, "", false},
		{[]string{"chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"}, "", false},
		{[]string{"x.json", "other@example"}, "", false},
		{[]string{"--run-anything"}, "", false},
		{[]string{"yt-toolbar-master@chidi0716"}, "", false},
	}
	for _, c := range cases {
		got, ok := identifyCaller(c.args)
		if got != c.want || ok != c.ok {
			t.Errorf("%v: got %q %v", c.args, got, ok)
		}
	}
}
