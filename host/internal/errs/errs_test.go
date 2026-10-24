package errs

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"testing"
)

func TestFromFS(t *testing.T) {
	for _, c := range []struct {
		err  error
		want Code
	}{
		{&os.PathError{Op: "write", Path: "/x", Err: syscall.ENOSPC}, DiskFull},
		{errors.New("There is not enough space on the disk."), DiskFull},
		{&os.PathError{Op: "open", Path: "/x", Err: os.ErrPermission}, PermissionDenied},
		{fmt.Errorf("wrapped: %w", New(Network, "offline")), Network},
		{errors.New("something else"), Unknown},
	} {
		if got := FromFS(c.err).Code; got != c.want {
			t.Errorf("%v: %s, want %s", c.err, got, c.want)
		}
	}
	if FromFS(nil) != nil {
		t.Error("nil")
	}
}
