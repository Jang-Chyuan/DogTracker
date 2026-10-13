# DogTracker

DogTracker 是一個 React Native Android App，透過 BLE 連接相容的 Heltec V4 `DogGPS-MasterN` 裝置，接收並顯示 Master 與 Slave 的定位、距離、活動、訊號及電池資料。

目前可搭配 Master 3、Master 5，以及遵循相同 QR 設定與 BLE 通訊協定的其他 `DogGPS-MasterN` 裝置。裝置名稱與連線參數由 QR Code 提供，不在畫面或連線流程中綁定特定 Master 編號。

## 主要功能

- 使用 App 內建 CameraX 相機與 bundled ML Kit 掃描 QR Code，不需另外安裝掃描 App。
- ML Kit 僅辨識 `FORMAT_QR_CODE`，辨識結果會立即交由 `parseMasterQr()` 驗證。
- 支援依 QR 設定自動尋找裝置，以及手動掃描相容的 `DogGPS-MasterN` BLE 裝置。
- 訂閱 BLE GATT Notify，顯示 Master／Slave GPS、距離、速度、衛星、HDOP、活動、RSSI、SNR 與電池狀態。
- 透過 Kotlin connected-device 前景服務維持長期 BLE GATT 連線。
- App 程序遭系統重建後，可由前景服務恢復裝置連線、GATT 探索與 Notify 訂閱，並以退避機制自動重連。
- 透過 BLE 查看、新增與刪除裝置的 Wi-Fi 設定。
- 將收到的狀態資料寫入本機 SQLite，並提供資料表檢視。
- BLE 已連線或背景服務運行時，首頁返回鍵會把 App 切到背景；未連線時會顯示退出確認。

## 系統需求

- Windows 開發環境
- Node.js `>= 22.11.0`
- JDK 與 Android SDK／Platform Tools
- Android 實機（需支援 BLE）
- React Native `0.87.0`

## 安裝相依套件

```powershell
npm install
```

安裝完會自動跑 `patch-package`，套用 `patches/` 裡的修補：

- `react-native-maps+1.28.2.patch`：Android 地圖標記在還沒有自己的畫面（剛加上、或畫面先被移除）時先隱藏，不讓 Google 畫出預設紅色圖釘（上游問題 react-native-maps#5756、#5778）。升級 react-native-maps 時要重新產生這個修補（`npx patch-package react-native-maps --exclude '^package\.json$|/build/|\.cxx/|/\.gradle/'`），`__tests__/ReactNativeMapsPatch.test.js` 會檢查版本和修補是否套上。

## 開發執行

啟動 Metro：

```powershell
npm start
```

在另一個終端確認手機、設定連接埠並安裝 Debug 版本：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
npm run android
```

Debug 版本需要 Metro。若要安裝不依賴 USB 或 Metro 的版本，請使用下方 Release APK 流程。

## 檢查與測試

```powershell
npm run lint
npm test -- --runInBand
```

## 建置及安裝 Release APK

```powershell
cd android
.\gradlew assembleRelease
cd ..
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

APK 輸出位置：

```text
android\app\build\outputs\apk\release\app-release.apk
```

Release APK 已包含 JavaScript bundle，可在沒有 USB 與 Metro 的情況下啟動。首次使用時仍須允許 App 所要求的相機、附近裝置、藍牙及對應 Android 版本所需權限。

## 持續整合（GitHub Actions）

工作流程定義在 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

| 觸發 | 執行內容 |
| --- | --- |
| 對 `main` 開 PR | `npm ci`、`npm test -- --runInBand`、`npx eslint src __tests__ App.js` |
| push／merge 到 `main` | 同上，全部通過後再 `cd android && ./gradlew assembleRelease` |
| 手動（Actions 頁的 Run workflow） | 同 push；用於補跑沒有觸發到的建置 |

> commit 訊息若含有 `[skip ci]` 標記，GitHub 會跳過整個 workflow。squash 合併會把被 squash 的 commit 訊息併進 `main` 的 commit，所以連「在說明裡提到這個標記」都會讓那次合併不建置 —— 這時用手動觸發補跑。

`main` 建置成功後會產出兩份相同的 APK：

- workflow artifact `app-release.apk`：在該次 run 的頁面下載，保留 30 天。
- GitHub pre-release `v<版本>`：附檔名為 `DogTracker-<版本>.apk`，手機可直接點連結下載安裝。

兩者都沿用 repo 內的 debug keystore 簽章，僅供內部測試，不可上架。

### 版本號

發出來的版本是 `MAJOR.MINOR.PATCH`：

- **MAJOR.MINOR** 來自 `package.json` 的 `version`，由人決定。目前為 **0.3.x beta**；使用者決定正式版時才改 1.0.x。
- **PATCH** 是 `main` 上的 commit 數，每次合併自動往上走，CI 不需要把任何東西 commit 回 repo。

建置時以 `APP_VERSION_NAME` 與 `APP_VERSION_CODE` 傳進 Gradle，所以 APK 的 `versionName` 和 release tag 一致，`versionCode` 則是 **1000 + 同一個 commit 數**（單調遞增，升級不會倒退）。`package.json` 裡的 PATCH 不影響發版，只有 MAJOR.MINOR 有意義。

`versionCode` 的固定 offset 1000（`scripts/app-version.js` 的 `VERSION_CODE_OFFSET`）是因為測試裝置上已經裝過加 offset 前的 build（Codex branch build 與手動 override），versionCode 最高到約 280，而 main 當時只有約 172 個 commit。Android 不允許用較低的 versionCode 覆蓋安裝，release build 也不能用 `-d`，只能解除安裝，會清掉本機資料與登入。加上 offset 後 main 從約 1172 起跳，高於所有舊 build。顯示給使用者的 `versionName` 不加 offset，仍是 `0.3.<commit 數>`（本機 `0.3.<基準>+<n>`），所以 versionCode 永遠等於 1000 + 名稱中的 commit 數，例如 `0.3.172` 的 versionCode 是 1172。offset 只能加大不能減少，最大值為 Android 上限 2100000000。

本機 Gradle 與 CI 共用 `scripts/app-version.js`，不使用 semver 公式。`node scripts/app-version.js` 可先查看版本。淺層 checkout 會拒絕推算，先執行 `git fetch --unshallow`；CI 保持 `fetch-depth: 0`。

- **CI（環境變數 `CI=true`）**：以正在建置的 `HEAD` 完整歷史 commit 數產生 `0.3.<commit 數>`，`versionCode` 是 1000 + commit 數。
- **本機**：只數到 `HEAD` 與 `origin/main` 的 merge-base（沒有 `origin/main` 時改用本機 `main`，兩者都沒有才退回 `HEAD` 的 commit 數）。在 main 上建置與 CI 結果相同；feature branch／worktree 會得到 `0.3.<main 基準>+<本機多出的 commit 數>`，例如 `0.3.195+3`，`versionCode` 則是 1000 + 基準 195 = 1195。這樣 branch 的 commit 數再多也不會高過之後 main/CI 的 APK，之後 `adb install -r` 安裝 main 的 APK 不會出現 `INSTALL_FAILED_VERSION_DOWNGRADE`，也不必 `-d` 或清資料。本機 `origin/main` 太舊時基準也會偏舊，建置前先 `git fetch origin`。

Gradle 設定階段就會執行 `node scripts/app-version.js`。從 Android Studio 等 IDE 啟動時 PATH 可能沒有 nvm／Homebrew 的 node，請把 `NODE_BINARY` 設成 node 的絕對路徑（環境變數，或寫在已被 git 忽略的 `android/local.properties`：`NODE_BINARY=/path/to/node`）。

Google 地圖金鑰來自環境變數 `GOOGLE_MAPS_ANDROID_API_KEY` 或 `android/local.properties` 的同名設定（不要 commit）。沒有金鑰的 APK 每次都是「地圖打不開」，連上網路或按「重試」都不會好，所以本機建置 Release 時沒有金鑰會直接失敗；新的 worktree 記得從主要 checkout 複製 `android/local.properties`。CI（`CI=true`）照舊可以在沒有 secret 時建置；本機確實要建沒有地圖的 APK 時設 `ALLOW_MISSING_MAPS_KEY=true`。

需要重建指定版本或從沒有 `.git` 的來源包建置時，必須一起提供 `APP_VERSION_NAME` 和 `APP_VERSION_CODE`；只提供一個會失敗。override 保留既有 CI 傳入已解析版本的方式：`APP_VERSION_CODE` 原樣使用，不會再加 offset（CI 傳入的已經是 `scripts/app-version.js` 加過 offset 的值）。手動 override 時記得自行使用 1000 + commit 數，發布時仍使用完整 HEAD 歷史的數值，不可任意降低 versionCode。設定頁顯示原生 APK 的 `BuildConfig.VERSION_NAME`，不另寫固定版本文字。

## 使用流程

1. 開啟 App 並允許必要權限。
2. 點選「自動 BLE QR Code 掃描」，將裝置 QR Code 對準相機；也可以選擇「手動 BLE 掃描」。
3. App 驗證 QR 內容後，依其中的 Master ID、BLE 名稱與 UUID 尋找並連接裝置。
4. 連線成功後，在 設定 → 診斷 → 即時資料 查看收到的資料，在 設定 → 進階 → 接收器 Wi-Fi 設定接收器的 Wi-Fi。
5. 需要長期接收時選擇「切到背景執行」。若要停止自動恢復與背景接收，請在 App 內選擇「停止背景接收」。

> 若 BLE 掃描持續找不到裝置，請先確認 Master 已開機、正在廣播且未被其他手機連線；必要時重新啟動或重設 Master 後再掃描。

## BLE 通訊協定

| 項目 | 值 |
| --- | --- |
| 裝置名稱 | `DogGPS-MasterN`，由裝置 QR 設定提供 |
| Service UUID | `7f510001-6d9e-4e2f-a671-8f3f2d49a001` |
| Data Characteristic UUID | `7f510002-6d9e-4e2f-a671-8f3f2d49a001` |
| Wi-Fi Config Characteristic UUID | `7f510003-6d9e-4e2f-a671-8f3f2d49a001` |
| 資料方向 | Master Notify 至手機 |

Wi-Fi 設定透過 write-with-response 傳送 Base64 編碼的 UTF-8 JSON；相容韌體必須提供可寫入的 Wi-Fi Config Characteristic。

## 主要程式位置

```text
App.js                              App 畫面流程與即時 BLE 狀態
src/ble/                            BLE 掃描、連線與資料解析
src/qr/MasterQrParser.js            Master QR 設定驗證
src/screens/                        地圖、接收器掃描
src/settings/                       設定各頁（含 進階：Wi-Fi、刪除狗資料；診斷：資料表）
src/database/                       SQLite 儲存
src/models/DogStatus.js             共用資料模型
android/app/src/main/java/com/dogtracker/
  BleForegroundService.kt           BLE 前景服務及程序復原
  QrCameraViewManager.kt            D3a 掃描框裡的相機（CameraX／ML Kit）
```

更完整的 BLE 協定、模組分工與協作規則請參閱 [PROJECT_GUIDE.md](PROJECT_GUIDE.md)。

環境分類的模型、資料流程與判定限制請參閱 [機器學習（ML）說明](src/ml/README.md)。
