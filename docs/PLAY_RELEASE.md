# Google Play beta 發佈（0.3.x）

更新日期：2026-10-09。目前 `package.json` 為 `0.3.0`，CI 發佈 `0.3.<commit count>`，Android `versionCode` 使用 commit count。上架測試不代表正式版本線開始；只有使用者明確指示才切換正式版本線。每次 Play 上傳需使用尚未使用且遞增的 versionCode；同一 CI commit 重跑不會增加版本碼。

## 先決定套件識別碼

`android/app/build.gradle` 的 `applicationId` 是 **`com.antgo.dogtracker`**（2026-10-09 決定；當天 Play 商店查不到同名 App，但未公開的 App 也會佔用名稱，第一次上傳時 Play Console 才會最後確認）。Play 建立套件後不能更換識別碼；日後變更會被視為新 App。舊的 `com.dogtracker` 版本會被當成另一個 App，可以並存，本機資料不會自動搬過來。

保留 `namespace "com.dogtracker"` 時，本專案必要的產品程式變更只有 `android/app/build.gradle` → `defaultConfig.applicationId`。`AndroidManifest.xml` 的 FileProvider authority 使用 `${applicationId}.historyexports`，`HistoryExportPackage.kt` 使用 `context.packageName + ".historyexports"`，兩者會自動一致。manifest 的相對類別名稱由 namespace 解析，Kotlin package／目錄、imports、R／BuildConfig、ProGuard 的 `com.dogtracker` keep rules、`package.json` 的 codegen `javaPackageName` 均可保留，無須搬動或改名。

`BleForegroundService.kt` 的 `com.dogtracker.ble.*` action 常數與 `CloudSecureStorage.js` 的 `com.dogtracker.supabase.*` keychain service 是自訂名稱，並非 applicationId 查詢；保留 namespace 時不必改，若團隊另決定改名，需一起更新引用並處理既有儲存資料。識別碼變更後必須更新 Google Maps Android key 限制、這兩份發佈文件及使用 package 的 adb／測試說明。新識別碼會另裝一個 App，不會自動搬移舊 App 的本機資料。

## 開發者帳號與建立 App

1. 由帳號持有人註冊 [Play Console 開發者帳號](https://support.google.com/googleplay/android-developer/answer/6112435?hl=zh-Hant)，選擇符合實際身分的個人或機構帳號，支付註冊費，完成聯絡資料與身分驗證。機構須按 Console 要求提供機構資料／D-U-N-S 等；新個人帳號另依提示完成 Android 裝置驗證。勿把證件或帳號憑證放進 repository。
2. 在 Console 建立應用程式，設定預設語言、名稱、App 類型、免費／付費與必要聲明。先完成上方識別碼決策，再上傳第一個 AAB。
3. 配置團隊成員權限、支援信箱與發佈地區。測試帳號使用最小必要權限。

## Play App Signing 與 upload key

依 [RELEASE_SIGNING.md](RELEASE_SIGNING.md) 由維護者在私人環境建立、備份 upload key 並設定五個 GitHub secrets。CI 使用此 key 簽署 AAB；啟用 **Play App Signing**，由 Google 保管另一把 app-signing key，簽署交付使用者的 APK。不要把私鑰送進聊天或 commit。

首次發佈依 Console 的 App integrity／App signing 流程啟用 Play App Signing，建議讓 Google 產生 app-signing key。使用同一 upload key 簽署第一個 AAB，並依 Console 要求登錄／上傳 upload key 的**公開憑證**（首次 AAB 也可能自動登錄）。如需 PEM，維護者在私人資料夾執行：

```sh
keytool -exportcert -rfc -keystore dogtracker-upload.jks -alias dogtracker -file upload_certificate.pem
```

密碼由互動提示輸入。公開憑證不是 keystore；只上傳 Console 要求的憑證，不上傳私鑰檔。核對 Console 顯示的 upload certificate 與 CI 使用的憑證一致。upload key 遺失可申請重設，不會更換 Play 的 app-signing key。參考 [Android 簽章文件](https://developer.android.com/studio/publish/app-signing)。

Google Maps key 的 Android application restrictions 必須加入同一 applicationId 的**兩筆 SHA-1**：upload-key SHA-1（側載 APK）與啟用後 Console 顯示的 **Play app-signing SHA-1**（Play 安裝）。本機 debug 測試另外保留 debug SHA-1。若更改 applicationId，兩筆 package 都要改。

## 從 CI artifact 手動上傳測試版本

1. main 的 CI `release-apk` job 先跑 checks，再執行 `./gradlew assembleRelease bundleRelease`，以 upload key 簽署兩種格式。
2. 開啟成功的 GitHub Actions run，下載 `DogTracker-Play-0.3.<commit count>` artifact，解壓取得 `app-release.aab`（來源路徑 `android/app/build/outputs/bundle/release/app-release.aab`）。保留期 30 天，確認 run 的 commit、版本碼及 signing secrets 已正確設定。AAB 不能直接點選安裝，也不可用 debug／一次性測試簽章的 AAB 上傳。
3. 先在 **Internal testing（內部測試）**建立版本，上傳 AAB、填 beta 更新說明、處理 Console 驗證訊息，加入團隊測試者並分享 opt-in 連結。以 Play 安裝驗證登入、地圖、BLE、定位、同步與資料匯出。
4. 團隊驗證後再推進 **Closed testing（封閉測試）**，設定測試群組、地區及連結。2023-11-13 之後建立的新個人開發者帳號，申請 production access 前，須讓至少 **12 位測試者連續 opt-in 14 天**並完成封閉測試，之後向 Console 申請 production access；滿足天數不等於自動核准。內部測試不替代此條件。見 [官方測試要求](https://support.google.com/googleplay/android-developer/answer/14151465?hl=zh-Hant)。

GitHub 公開 prerelease 繼續只有供側載測試的 APK，**不放 AAB**。APK 與 Play 安裝通常簽章不同，不能互相覆蓋；切換前先匯出／同步資料，再解除安裝。此次沒有自動上傳 Play；未來若要自動化，服務帳號與 Console 權限須由使用者先建立，JSON 憑證不可 commit 或列印。

## 商店頁與審查資料

準備 App 名稱、簡短／完整說明、圖示、特色圖片、手機截圖、支援 email、分類、地區、內容分級、目標受眾、廣告聲明與 App access。須登入的功能需向審查員提供能操作的測試帳號及 BLE／設備功能說明，憑證只在 Console 私人欄位提供。

**隱私權政策 URL 必填**：使用公開可存取、無地區封鎖、非 PDF 的網頁，在 Console 與 App 內提供入口；列明開發者／App 名稱、聯絡方法、定位／帳號／裝置資料用途、Supabase／Google Maps 處理、保存期間、刪除與權利行使。不要把 repository 文件路徑當 URL。若未具備政策頁及 App 入口，需在送審前補齊。若提供 App 內建立帳號，另須符合帳號刪除及網頁刪除申請要求。參考 [Google Play 使用者資料政策](https://support.google.com/googleplay/android-developer/answer/10144311?hl=zh-Hant)。

## Data safety 表單核對

以下根據目前程式做填表盤點；最終答案需核對部署中的 Supabase／Edge Function、Google Maps SDK 行為與伺服器 logs。權限本身不等於資料已被上傳；只留在裝置內的資料不算 off-device collection。不要把持久儲存的雲端軌跡勾成 ephemeral processing。

| 項目 | 本專案與填表判斷 |
| --- | --- |
| 精確位置 | manifest 有 `ACCESS_FINE_LOCATION`，App 處理 GPS／狗的座標與軌跡，BLE 上傳佇列可將 telemetry 送至雲端。雲端軌跡若可連結使用者位置，須申報 precise location collection，用於 App functionality；需確認手機自身軌跡是否離開裝置，不能宣稱所有定位都只存本機。 |
| 概略位置 | manifest 有 `ACCESS_COARSE_LOCATION`，使用者可只允許概略位置。若概略位置被送至 Supabase 或 Maps 等 off-device 端，另申報 approximate location；不能只因有 fine 權限就漏掉，也不能只憑 coarse 權限推定有收集。 |
| Email／使用者 ID | `CloudScreen.js` 使用 email 與密碼登入 Supabase Auth，session 含 email／user ID，雲端資料依 owner_user_id 隔離。申報 email address 與 user IDs collection，用於 account management／App functionality，並在政策說明驗證資料處理。 |
| App activity？ | 雲端 telemetry 含 activityScore／activityValid 等狗的活動量，不等於使用者點擊的 App interactions。未看到專用點擊分析 SDK；需核對伺服器 logs、SDK 與是否上傳搜尋／操作紀錄，再決定 App interactions／in-app search history／other user-generated content 等，勿僅因欄位叫 activity 就分類為 App activity。 |
| Device or other IDs？ | `BleUploadQueue.kt` 產生並持久儲存 UUID `phone_id`，`BleUploadPayload.js` 與 `UploadService.js` 將它送至 Supabase `ingest-phone-telemetry`，另含 master_id／slave_id、event_id，雲端有 gateway_id。這是實際 off-device 的裝置識別資料，應申報 Device or other IDs collection，用於 App functionality。未看到 Android Advertising ID 採集；不能因此宣稱沒有裝置 ID。Maps SDK／後端 logs 也要核對。 |
| 提供給 Supabase | Auth email／帳號資料及雲端 telemetry 由 Supabase 處理。隱私權政策須揭露。Data safety 的「shared」有 service provider 例外：若 Supabase 只代表開發者依指示處理且符合條件，表單可不算第三方 sharing，但仍須申報 collection；若用於其他目的則重新評估，勿一律填「無共享」。Google Maps SDK 也須獨立核對。 |
| 傳輸加密 | `CloudClient.js` 只接受 `https://*.supabase.co`；release manifest 的 cleartext 預設關閉。Supabase 雲端連線以 HTTPS／TLS 加密，申報「所有收集資料傳輸時加密」前仍須核對所有 SDK、後端及傳輸路徑；此項不是 BLE 本身的加密保證。 |

對每項實際收集資料填用途、必要／選用、是否 ephemeral、共享與刪除機制；說明雲端登入／同步的使用者選擇及保存期限。Google Maps 的資料需參照實際 SDK 版本與官方 disclosure，不能只盤點自有 JavaScript。表單分類與 service provider 例外見 [Data safety 官方說明](https://support.google.com/googleplay/android-developer/answer/10787469?hl=zh-Hant)。

## 權限與前景服務申報

`android/app/src/main/AndroidManifest.xml` 的 foreground service types 精確為：

| Type | Service | 使用者功能 |
| --- | --- | --- |
| `location` | `.location.LocationTrackerService` | 使用者啟動的手機定位／軌跡追蹤，通知提示追蹤中。 |
| `connectedDevice` | `.BleForegroundService` | 維持與狗追蹤設備的 BLE 連線並接收資料。 |
| `dataSync` | `.cloud.SearchRelayService` | 雲端搜尋中繼／資料同步。 |

對應權限為 `FOREGROUND_SERVICE` 與 `FOREGROUND_SERVICE_LOCATION`、`FOREGROUND_SERVICE_CONNECTED_DEVICE`、`FOREGROUND_SERVICE_DATA_SYNC`。依 Console 要求為每種類型提供用途、使用者觸發路徑、持續通知／停止方式及展示影片；送審前核對實際服務生命週期與平台時間限制，聲明不可只複製權限名稱。見 [前景服務要求](https://support.google.com/googleplay/android-developer/answer/13392821?hl=zh-Hant)。

目前 manifest **沒有請求 `ACCESS_BACKGROUND_LOCATION`**；定位使用 foreground service，不能將它描述成已取得 Android 背景定位權限。背景執行的實際定位行為仍須遵守顯著揭露、同意及 Console 政策；送審前再次檢查 merged release manifest，避免相依套件新增權限。

Bluetooth／Nearby devices：Android 12+ 使用 `BLUETOOTH_SCAN`（`neverForLocation`）及 `BLUETOOTH_CONNECT`，Android 11 以下使用 `BLUETOOTH`／`BLUETOOTH_ADMIN`（maxSdk 30）。用途是發現並連線團隊的狗追蹤 Master 設備、接收 telemetry，不是廣告或利用掃描推斷手機位置；GPS 定位用途另由 location 權限說明。`neverForLocation` 不代表 App 沒有 GPS 功能。另有 `POST_NOTIFICATIONS`（追蹤通知）、`CAMERA`（QR 掃描）、`INTERNET`／`WAKE_LOCK`，均須保持用途與 App 揭露一致。

## Target SDK 與最後核對

`android/build.gradle` 的 `rootProject.ext.targetSdkVersion` 精確為 **36（Android 16）**，`compileSdkVersion` 是 37。依 2026-10-09 查核的 [Google Play target API 要求](https://support.google.com/googleplay/android-developer/answer/11926878?hl=zh-Hant)，2026-08-31 起一般手機新 App／更新須 target API 36 以上；本專案符合目前 target API 門檻。**每次上傳前，使用者仍須在 Play Console 重新確認最新 deadline／要求**，符合 SDK 門檻不等於所有政策已通過。

首次 Play 審查前確認唯一 applicationId、upload 憑證、兩筆 Maps SHA-1、實機測試、Data safety、政策 URL／App 入口、前景服務聲明與測試軌道設定都已完成。
