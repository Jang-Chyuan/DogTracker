# DogTracker beta 簽章

目前版本線為 `0.3.x` beta，`package.json` 為 `0.3.0`；CI 使用 major/minor 與 main 的 commit 數發佈 `0.3.<commit count>`。只有使用者明確指示才啟動正式版本線。CI 以 DogTracker 專用 **upload key** 簽署 APK 與 AAB；Google Play App Signing 另行保管 app-signing key，並用它簽署 Play 安裝的 APK。請由維護者自行建立及保管 upload key，勿提交金鑰、密碼或 base64 內容。

CI 同時執行 `assembleRelease bundleRelease`。公開 GitHub prerelease 只保留供側載測試的 APK；Play 用的 `app-release.aab` 僅放在 workflow artifact（保留 30 天），由維護者手動上傳。設定步驟見 [Google Play beta 發佈](PLAY_RELEASE.md)。

## 建立與備份金鑰

安裝 JDK 17，確保 `keytool` 在 PATH。在專案外的私人資料夾執行，下列指令適用 macOS Terminal 與 Windows PowerShell：

```sh
keytool -genkeypair -v -keystore dogtracker-upload.jks -storetype JKS -alias dogtracker -keyalg RSA -keysize 4096 -validity 10000
```

依提示輸入 keystore 密碼、憑證身分與 key 密碼（可與 keystore 密碼相同）。不要把密碼寫進命令列、聊天或版本控制。

立即將 `.jks` 備份到至少兩個安全、獨立的位置（例如加密離線儲存及受控備份），密碼另存密碼管理器。**同一私鑰無法重新產生或復原**；側載 APK 若更換簽章，便不能覆蓋原安裝。Play App Signing 的 upload key 遺失時可向 Play 申請重設，既有 Play 安裝的 app-signing key 不變。GitHub secret 不是可取回的備份。

## GitHub Actions secrets

在 repository 的 **Settings → Secrets and variables → Actions → New repository secret** 加入以下五項：

| 名稱 | 內容 |
| --- | --- |
| `DOGTRACKER_UPLOAD_KEYSTORE_BASE64` | 完整 keystore 的 base64（不是檔案路徑） |
| `DOGTRACKER_UPLOAD_STORE_FILE` | `dogtracker-upload.jks`（固定檔名；CI 自動加上 repository 外的 runner 暫存路徑） |
| `DOGTRACKER_UPLOAD_STORE_PASSWORD` | keystore 密碼 |
| `DOGTRACKER_UPLOAD_KEY_ALIAS` | `dogtracker` |
| `DOGTRACKER_UPLOAD_KEY_PASSWORD` | alias 的 key 密碼 |

macOS（將 base64 直接送剪貼簿，不在終端列印）：

```sh
base64 < dogtracker-upload.jks | tr -d '\n' | pbcopy
```

Windows PowerShell：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\dogtracker-upload.jks).Path)) | Set-Clipboard
```

貼入 base64 secret，完成後清空剪貼簿。CI 在 repository 外的 runner 暫存目錄解碼，建置後以 `always()` 刪除；缺少金鑰或簽章設定會停止 release 建置。

## 本機 release 簽章

本機可設定上述四個 `DOGTRACKER_UPLOAD_*` 環境變數（不含 BASE64），或使用已被 gitignore 排除的 `android/keystore.properties`，欄位名稱與環境變數一致：

```properties
DOGTRACKER_UPLOAD_STORE_FILE=/absolute/private/path/dogtracker-upload.jks
DOGTRACKER_UPLOAD_STORE_PASSWORD=<自行填入>
DOGTRACKER_UPLOAD_KEY_ALIAS=dogtracker
DOGTRACKER_UPLOAD_KEY_PASSWORD=<自行填入>
```

Windows 路徑使用正斜線，例如 `C:/Private/dogtracker-upload.jks`。相對路徑以 `android/` 為基準；每個環境變數優先於 properties。四欄必須完整，部分設定會直接失敗。

macOS：`cd android && ./gradlew assembleRelease bundleRelease`。
Windows PowerShell：先 `cd android`，再 `./gradlew.bat assembleRelease bundleRelease`。
沒有任何設定時，本機會顯示醒目警告並使用公開 debug key，該 APK／AAB 不可發佈；`CI=true` 時禁止此 fallback。

## Google Maps 與手機移轉

在私人金鑰資料夾執行（macOS 與 Windows 相同，密碼由互動提示輸入）：

```sh
keytool -list -v -keystore dogtracker-upload.jks -alias dogtracker
```

取出憑證的 **SHA-1**，在 Google Cloud Console → APIs & Services → Credentials → 對應 Google Maps API key → Application restrictions → Android apps，新增已決定的 applicationId（目前 **`com.dogtracker`**）與 **upload-key SHA-1**；加入 Play App Signing 後，再從 Play Console 取得 **app-signing SHA-1** 並新增第二筆相同 package 的限制，儲存設定。需要繼續本機測試時保留原 debug SHA-1 的獨立項目。

**舊的 debug 簽章 APK 無法直接升級成新的 release 簽章 APK。** 手機須先匯出／上傳重要資料，再解除安裝舊 App 一次，最後安裝新版；解除安裝會清除 App 資料。往後只要維持同一 upload key（側載 APK），即可正常更新。

Play 安裝與側載 APK 通常使用不同簽章，無法互相覆蓋更新；切換管道前先匯出／同步資料，再解除安裝，否則會失去本機資料。
