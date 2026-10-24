// yte-release 是維護者與發佈流程使用的工具（plan 4.9、4.10），不會發佈給使用者。
// 本專案不使用自己的簽章金鑰（008 FR-51），所以這裡沒有任何與金鑰有關的指令。
//
//	lock-check [-lock release/components.lock.json] [-online] [-download]
//	                                              檢查 lock 檔；-online 時與官方檢查碼比對，
//	                                              -download 時另外下載每個檔案計算 SHA256
//	manifest  -lock <lock> -version <x.y.z> -tag <vx.y.z> -helpers <資料夾> -out components.json
//	check     -in components.json                 檢查清單格式與網址（發佈前最後一次確認）
//	zip       -dir <資料夾> -out <檔案.zip>         把資料夾壓縮成 zip（保留執行權限）
package main

import (
	"archive/zip"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/chidi0716/yt-toolbar-master/host/internal/release"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch cmd, args := os.Args[1], os.Args[2:]; cmd {
	case "lock-check":
		err = lockCheck(args)
	case "manifest":
		err = manifest(args)
	case "check":
		err = check(args)
	case "zip":
		err = zipDir(args)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "yte-release:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: yte-release lock-check|manifest|check|zip [flags]")
}

func check(args []string) error {
	fl := flag.NewFlagSet("check", flag.ExitOnError)
	in := fl.String("in", "", "components.json")
	fl.Parse(args)
	if *in == "" {
		return errors.New("-in is required")
	}
	data, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	m, err := release.ParseManifest(data, release.AllowedURL)
	if err != nil {
		return err
	}
	fmt.Printf("ok: components.json %s is valid\n", m.Version)
	return nil
}

func lockCheck(args []string) error {
	fl := flag.NewFlagSet("lock-check", flag.ExitOnError)
	lockPath := fl.String("lock", filepath.Join("..", "release", "components.lock.json"), "lock file")
	online := fl.Bool("online", false, "compare with the official checksum files")
	download := fl.Bool("download", false, "also download every file and check its SHA256 (implies -online)")
	fl.Parse(args)
	data, err := os.ReadFile(*lockPath)
	if err != nil {
		return err
	}
	l, err := release.ParseLock(data)
	if err != nil {
		return err
	}
	fmt.Printf("ok: %s is valid (yt-dlp %s, deno %s, ffmpeg %s)\n", *lockPath,
		l.Tools[release.ToolYtDlp].Version, l.Tools[release.ToolDeno].Version, l.Tools[release.ToolFFmpeg].Version)
	if !*online && !*download {
		return nil
	}
	tmp, err := os.MkdirTemp("", "yte-lock-check-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	logf := func(format string, a ...any) { fmt.Printf(format+"\n", a...) }
	return l.VerifyOnline(context.Background(), release.NewFetcher("release"), *download, tmp, logf)
}

func manifest(args []string) error {
	fl := flag.NewFlagSet("manifest", flag.ExitOnError)
	lockPath := fl.String("lock", filepath.Join("..", "release", "components.lock.json"), "lock file")
	version := fl.String("version", "", "release version (x.y.z)")
	tag := fl.String("tag", "", "release tag (vx.y.z)")
	helpers := fl.String("helpers", "", "folder with yte-host-darwin-arm64, yte-host-darwin-amd64, yte-host-windows-amd64.exe")
	out := fl.String("out", "", "components.json to write")
	fl.Parse(args)
	if *version == "" || *helpers == "" || *out == "" {
		return errors.New("-version, -helpers and -out are required")
	}
	if *tag == "" {
		*tag = "v" + *version
	}
	data, err := os.ReadFile(*lockPath)
	if err != nil {
		return err
	}
	l, err := release.ParseLock(data)
	if err != nil {
		return err
	}
	m, err := release.BuildManifest(l, *version, *tag, *helpers)
	if err != nil {
		return err
	}
	b, err := m.Marshal()
	if err != nil {
		return err
	}
	return os.WriteFile(*out, b, 0o644)
}

func zipDir(args []string) error {
	fl := flag.NewFlagSet("zip", flag.ExitOnError)
	dir := fl.String("dir", "", "folder to compress (its name becomes the top folder in the zip)")
	out := fl.String("out", "", "zip file to write")
	fl.Parse(args)
	if *dir == "" || *out == "" {
		return errors.New("-dir and -out are required")
	}
	f, err := os.Create(*out)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	root := filepath.Clean(*dir)
	top := filepath.Base(root)
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		h, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		h.Name = top + "/" + filepath.ToSlash(rel)
		h.Method = zip.Deflate
		w, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		src, err := os.Open(p)
		if err != nil {
			return err
		}
		defer src.Close()
		_, err = io.Copy(w, src)
		return err
	})
	if cerr := zw.Close(); err == nil {
		err = cerr
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}
