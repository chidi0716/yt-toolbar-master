# 擴充功能 ID 與原生訊息名稱

依 plan 3.3 固定。原生訊息設定檔（T15 的安裝腳本與範本）必須使用以下值。

專案改名為 YT Toolbar Master（T52）後，這些值**維持不變**，否則已安裝的版本與小幫手會失聯（plan 3.3）。

| 項目 | 值 | 用在哪裡 |
|---|---|---|
| Chrome 擴充功能 ID | `bkjlangdjfpllnkcpfpdlajchbginjdj` | Chrome 原生訊息設定檔的 `allowed_origins`：`chrome-extension://bkjlangdjfpllnkcpfpdlajchbginjdj/` |
| Firefox 附加元件 ID | `youtube-extension@chidi0716` | `browser_specific_settings.gecko.id`；Firefox 原生訊息設定檔的 `allowed_extensions` |
| 原生訊息名稱 | `com.chidi0716.youtube_extension` | `runtime.connectNative()` 的參數、設定檔的 `name` 與檔名、Windows 登錄機碼名稱 |

## Chrome ID 的來源

- `wxt.config.ts` 中的 `CHROME_PUBLIC_KEY` 是一把 RSA 2048 公鑰（SubjectPublicKeyInfo，DER 格式再以 base64 編碼），只輸出到 Chrome 版 manifest 的 `key` 欄位。
- ID 計算方式：對 DER 公鑰位元組取 SHA-256，取前 32 個十六進位字元，把 `0`–`f` 對應成 `a`–`p`。
- 驗證指令（在 repo 根目錄執行）：

  ```bash
  node -e "const k=require('fs').readFileSync('wxt.config.ts','utf8').match(/CHROME_PUBLIC_KEY =\s*'([^']+)'/)[1]; \
    const h=require('crypto').createHash('sha256').update(Buffer.from(k,'base64')).digest('hex').slice(0,32); \
    console.log([...h].map(c=>String.fromCharCode(97+parseInt(c,16))).join(''))"
  ```

## 私鑰

- 金鑰以 `openssl genpkey ... | openssl pkey -pubout -outform DER` 的管線產生，私鑰沒有寫入任何檔案，產生後即不存在。
- 未封裝載入只需要公鑰；只有自行打包 `.crx` 時才需要私鑰（見 `specs/QUESTIONS.md` Q3）。
- `.gitignore` 排除 `*.pem`、`*.key` 等檔名作為保險。
