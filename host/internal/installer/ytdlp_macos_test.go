package installer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chidi0716/yt-toolbar-master/host/internal/errs"
	"github.com/chidi0716/yt-toolbar-master/host/internal/platform"
	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

// TestExtractTree：整個解壓時保留資料夾、執行權限與符號連結（Python.framework）。
func TestExtractTree(t *testing.T) {
	root := t.TempDir()
	zp := filepath.Join(root, "yt-dlp_macos.zip")
	os.WriteFile(zp, macYtDlpZip(t, "1"), 0o644)
	dest := filepath.Join(root, "out", "yt-dlp")
	os.MkdirAll(filepath.Dir(dest), 0o755)
	if err := ExtractTree(zp, dest); err != nil {
		t.Fatal(err)
	}
	checkMacYtDlp(t, dest, "1")
	// dest 已經存在：拒絕（不覆蓋）。
	if err := ExtractTree(zp, dest); err == nil {
		t.Fatal("extracted into an existing folder")
	}
	// 不是 zip。
	os.WriteFile(zp, []byte("not a zip"), 0o644)
	if err := ExtractTree(zp, filepath.Join(root, "x")); code(err) != errs.ChecksumMismatch {
		t.Fatalf("not a zip: %v", err)
	}
}

// TestExtractTreeRejectsUnsafeEntries：路徑穿越、指向資料夾以外的符號連結、經過符號連結寫入、
// 不支援的檔案類型，都讓整個解壓失敗，而且不會寫到解壓資料夾以外。
func TestExtractTreeRejectsUnsafeEntries(t *testing.T) {
	file := func(name string) zipEntry { return zipEntry{name, "x", 0o644} }
	link := func(name, target string) zipEntry { return zipEntry{name, target, os.ModeSymlink | 0o777} }
	cases := map[string][]zipEntry{
		"parent dir":              {file("../evil")},
		"nested parent dir":       {file("a/../../evil")},
		"absolute":                {file("/tmp/evil")},
		"backslash":               {file(`..\evil`)},
		"drive letter":            {file("C:/evil")},
		"dot segment":             {file("a/./b")},
		"empty segment":           {file("a//b")},
		"link absolute":           {link("l", "/etc")},
		"link escapes":            {link("l", "../../etc")},
		"nested link escapes":     {zipEntry{"a/", "", os.ModeDir | 0o755}, link("a/l", "../../x")},
		"link with backslash":     {link("l", `..\x`)},
		"empty link":              {link("l", "")},
		"link through link":       {zipEntry{"a/", "", os.ModeDir | 0o755}, link("b", "a"), link("b/c", "..")},
		"link over file":          {file("l"), link("l", "x")},
		"duplicate file":          {file("a"), file("a")},
		"device or named pipe":    {zipEntry{"p", "", os.ModeNamedPipe | 0o644}},
		"link to missing parent":  {link("missing/l", "x")},
		"file below another file": {file("a"), file("a/b")},
	}
	for name, entries := range cases {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			outer := filepath.Join(root, "a", "b")
			os.MkdirAll(outer, 0o755)
			zp := filepath.Join(root, "evil.zip")
			os.WriteFile(zp, makeTreeZip(t, entries...), 0o644)
			dest := filepath.Join(outer, "yt-dlp")
			if err := ExtractTree(zp, dest); err == nil {
				t.Fatal("unsafe archive was accepted")
			}
			filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
				if err == nil && p != zp && !info.IsDir() && !strings.HasPrefix(p, dest+string(filepath.Separator)) {
					t.Errorf("written outside the folder: %s", p)
				}
				return nil
			})
		})
	}
	// 項目太多。
	var many []zipEntry
	for i := 0; i <= maxTreeEntries; i++ {
		many = append(many, zipEntry{fmt.Sprintf("f%d", i), "", 0o644})
	}
	root := t.TempDir()
	zp := filepath.Join(root, "many.zip")
	os.WriteFile(zp, makeTreeZip(t, many...), 0o644)
	if err := ExtractTree(zp, filepath.Join(root, "out")); err == nil {
		t.Fatal("too many entries were accepted")
	}
}

// macUpdate 是 UpdateMacYtDlp 的測試環境：已安裝 version 的未封裝版本，假伺服器的
// /yt-dlp/latest/ 提供 SHA2-256SUMS 與 yt-dlp_macos.zip。
type macUpdate struct {
	*env
	in *Installer
}

func newMacUpdate(t *testing.T) *macUpdate {
	e := newEnv(t)
	if err := e.install(e.installer(), e.m); err != nil {
		t.Fatalf("install: %v\n%s", err, e.out)
	}
	in := e.installer()
	in.YtDlpBase = e.url("/yt-dlp/latest/")
	return &macUpdate{env: e, in: in}
}

// publish 讓假伺服器的 latest 提供 zip，SHA2-256SUMS 中列出 sum（空字串時使用 zip 的 SHA256）。
func (u *macUpdate) publish(zip []byte, sum string) {
	if sum == "" {
		sum = release.HashBytes(zip)
	}
	u.srv.set("/yt-dlp/latest/yt-dlp_macos.zip", zip)
	u.srv.set("/yt-dlp/latest/SHA2-256SUMS", []byte(fmt.Sprintf("%s  yt-dlp.exe\n%s  yt-dlp_macos\n%s  yt-dlp_macos.zip\n", hex64('1'), hex64('2'), sum)))
}

func hex64(c byte) string { return strings.Repeat(string(c), 64) }

func (u *macUpdate) dir() string { return filepath.Join(u.layout.BinDir, "yt-dlp") }

func TestUpdateMacYtDlp(t *testing.T) {
	u := newMacUpdate(t)
	ctx := context.Background()

	// latest 與安裝的相同：只下載 SHA2-256SUMS。
	u.publish(macYtDlpZip(t, "2026.10.21"), "")
	if updated, err := u.in.UpdateMacYtDlp(ctx); err != nil || updated {
		t.Fatalf("same version: %v %v", updated, err)
	}
	if u.srv.hit("/yt-dlp/latest/SHA2-256SUMS") != 1 || u.srv.hit("/yt-dlp/latest/yt-dlp_macos.zip") != 0 {
		t.Error("downloaded the zip although it did not change")
	}

	// 新版本：下載、核對、整個替換。
	newZip := macYtDlpZip(t, "2026.11.01")
	u.publish(newZip, "")
	if updated, err := u.in.UpdateMacYtDlp(ctx); err != nil || !updated {
		t.Fatalf("new version: %v %v", updated, err)
	}
	checkMacYtDlp(t, u.dir(), "2026.11.01")
	st := LoadState(u.layout.InstallDir)
	if st.Archives["yt-dlp"] != release.HashBytes(newZip) {
		t.Errorf("archives: %v", st.Archives)
	}
	if _, ok := st.Tools["yt-dlp"]; ok || st.Tools["deno"] != "2.9.8" {
		t.Errorf("tools: %v", st.Tools)
	}
	entries, _ := os.ReadDir(u.layout.BinDir)
	for _, en := range entries {
		if strings.Contains(en.Name(), ".old") || strings.HasPrefix(en.Name(), ".download-") {
			t.Errorf("left behind: %s", en.Name())
		}
	}

	// 竄改的 zip（與 SHA2-256SUMS 不符）：保留舊版。
	u.publish(macYtDlpZip(t, "evil"), hex64('9'))
	if _, err := u.in.UpdateMacYtDlp(ctx); code(err) != errs.ChecksumMismatch {
		t.Fatalf("tampered: %v", err)
	}
	checkMacYtDlp(t, u.dir(), "2026.11.01")
	noStaging(t, u.layout.BinDir)

	// 不安全的 zip（檢查碼相符）：保留舊版。
	u.publish(makeTreeZip(t, zipEntry{"yt-dlp_macos", "x", 0o755}, zipEntry{"l", "../../../x", os.ModeSymlink | 0o777}), "")
	if _, err := u.in.UpdateMacYtDlp(ctx); err == nil {
		t.Fatal("unsafe zip was installed")
	}
	checkMacYtDlp(t, u.dir(), "2026.11.01")
	noStaging(t, u.layout.BinDir)

	// zip 中沒有 yt-dlp_macos：保留舊版。
	u.publish(makeTreeZip(t, zipEntry{"_internal/x", "x", 0o644}), "")
	if _, err := u.in.UpdateMacYtDlp(ctx); err == nil {
		t.Fatal("zip without yt-dlp_macos was installed")
	}
	checkMacYtDlp(t, u.dir(), "2026.11.01")

	// SHA2-256SUMS 中沒有 yt-dlp_macos.zip。
	u.srv.set("/yt-dlp/latest/SHA2-256SUMS", []byte(hex64('1')+"  yt-dlp.exe\n"+hex64('2')+"  yt-dlp_macos\n"))
	if _, err := u.in.UpdateMacYtDlp(ctx); code(err) != errs.UpdateFailed {
		t.Fatalf("no checksum: %v", err)
	}

	// 連不上。
	u.srv.setFail("/yt-dlp/latest/SHA2-256SUMS", true)
	if _, err := u.in.UpdateMacYtDlp(ctx); code(err) != errs.Network {
		t.Fatalf("network: %v", err)
	}
}

// TestUpdateMacYtDlpReplacesSingleFile：還是 v0.1.0 的單一執行檔時，即使 latest 的檢查碼與記錄相同，
// 也改裝未封裝版本並刪除舊檔（008 FR-15a）。
func TestUpdateMacYtDlpReplacesSingleFile(t *testing.T) {
	u := newMacUpdate(t)
	zip := macYtDlpZip(t, "2026.11.01")
	u.publish(zip, "")
	st := LoadState(u.layout.InstallDir)
	st.Archives["yt-dlp"] = release.HashBytes(zip)
	st.Save(u.layout.InstallDir)
	os.RemoveAll(u.dir())
	os.WriteFile(u.dir(), []byte("single-file yt-dlp"), 0o755)
	if !LegacyMacYtDlp(u.layout) {
		t.Fatal("LegacyMacYtDlp")
	}
	if updated, err := u.in.UpdateMacYtDlp(context.Background()); err != nil || !updated {
		t.Fatalf("%v %v", updated, err)
	}
	checkMacYtDlp(t, u.dir(), "2026.11.01")
	if LegacyMacYtDlp(u.layout) {
		t.Fatal("still legacy")
	}
	// 下載失敗時保留舊的單一執行檔（沒有東西可以執行比壞掉更糟）。
	os.RemoveAll(u.dir())
	os.WriteFile(u.dir(), []byte("single-file yt-dlp"), 0o755)
	u.srv.setFail("/yt-dlp/latest/yt-dlp_macos.zip", true)
	if _, err := u.in.UpdateMacYtDlp(context.Background()); code(err) != errs.Network {
		t.Fatalf("network: %v", err)
	}
	if readFile(t, u.dir()) != "single-file yt-dlp" {
		t.Error("old yt-dlp was not kept")
	}
	// 其他系統不算舊版。
	other := u.layout
	other.GOOS = "windows"
	if LegacyMacYtDlp(other) {
		t.Error("LegacyMacYtDlp outside macOS")
	}
}

// TestUpdateMacYtDlpSkipsWhenNotInstalled：安裝資料夾中沒有 yt-dlp（例如使用 Homebrew 的）：不連網。
func TestUpdateMacYtDlpSkipsWhenNotInstalled(t *testing.T) {
	home := t.TempDir()
	e := newEnv(t)
	in := e.installer()
	in.Layout = platform.LayoutFor("darwin", home, nil)
	in.YtDlpBase = e.url("/yt-dlp/latest/")
	if updated, err := in.UpdateMacYtDlp(context.Background()); err != nil || updated {
		t.Fatalf("%v %v", updated, err)
	}
	if e.srv.totalHits() != 0 {
		t.Error("connected although yt-dlp is not installed in the install folder")
	}
}

// TestReplaceDir：以資料夾取代檔案或資料夾；失敗時還原。
func TestReplaceDir(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "yt-dlp")
	os.WriteFile(dest, []byte("file"), 0o755)
	src := filepath.Join(dir, "new")
	os.MkdirAll(filepath.Join(src, "_internal"), 0o755)
	os.WriteFile(filepath.Join(src, "yt-dlp_macos"), []byte("1"), 0o755)
	if err := ReplaceDir(src, dest); err != nil {
		t.Fatal(err)
	}
	if readFile(t, filepath.Join(dest, "yt-dlp_macos")) != "1" {
		t.Fatal("not replaced")
	}
	src2 := filepath.Join(dir, "new2")
	os.MkdirAll(src2, 0o755)
	os.WriteFile(filepath.Join(src2, "yt-dlp_macos"), []byte("2"), 0o755)
	if err := ReplaceDir(src2, dest); err != nil {
		t.Fatal(err)
	}
	if readFile(t, filepath.Join(dest, "yt-dlp_macos")) != "2" {
		t.Fatal("folder not replaced")
	}
	// src 不存在：dest 還原。
	if err := ReplaceDir(filepath.Join(dir, "missing"), dest); err == nil {
		t.Fatal("no error")
	}
	if readFile(t, filepath.Join(dest, "yt-dlp_macos")) != "2" {
		t.Fatal("dest not restored")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("left behind: %v", entries)
	}
	// 留下的 .old-* 資料夾由 CleanupOld 刪除。
	stale := filepath.Join(dir, "yt-dlp.old-abc")
	os.MkdirAll(filepath.Join(stale, "_internal"), 0o755)
	os.WriteFile(filepath.Join(stale, "_internal", "x"), []byte("x"), 0o644)
	CleanupOld(dir)
	if _, err := os.Stat(stale); err == nil {
		t.Error(".old folder not removed")
	}
}
