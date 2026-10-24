package main

import "testing"

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
