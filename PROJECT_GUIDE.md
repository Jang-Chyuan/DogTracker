# DogTracker 專案指南

DogTracker 是 React Native Android App，透過 BLE 連接相容的 Heltec V4 `DogGPS-MasterN` 裝置，接收 Master 產生的精簡 OLED 資料，並顯示及保存 Master／Slave 的定位、距離、活動、訊號與電池資訊。

目前支援 Master 3、Master 5，以及使用相同 QR 設定格式與 BLE 協定的其他 `DogGPS-MasterN` 裝置。除了手動掃描的預設相容名稱之外，裝置識別與 Service UUID 由 QR Code 設定提供，不應在 UI、錯誤訊息或功能流程中寫死特定 Master 編號。

## 已實作功能

- 依裝置 QR 設定掃描及連接相容的 `DogGPS-MasterN`。
- 使用 App 內建 CameraX 預覽與 bundled ML Kit 離線掃描 QR Code。
- ML Kit 僅啟用 `Barcode.FORMAT_QR_CODE`，掃描結果由 `parseMasterQr()` 驗證後才能使用。
- QR 掃描框依辨識到的 QR 邊界動態貼合，成功時轉為綠色並短暫停留。
- 訂閱 BLE GATT Notify，解析 Base64 與精簡 JSON 資料。
- 使用 Android connected-device 前景服務保存 BLE 工作階段，並在程序重建後恢復 GATT 與 Notify。
- BLE 中斷後，以 2 至 30 秒的指數退避機制自動重連。
- 顯示 Master／Slave GPS、距離、速度、衛星、HDOP、活動、RSSI、SNR 與電池狀態。
- 透過 BLE 查看、新增及刪除 Master 的 Wi-Fi 設定。
- 將狀態寫入 SQLite，提供可選欄位的資料表畫面。
- 支援 Android 8.1 與 Android 12+ 所需的 BLE 權限，以及相機、通知和前景服務權限。
- 建置不依賴 USB 或 Metro 的獨立 Release APK。

## 主要模組

以下列出目前的主要目錄與關鍵檔案，方便找入口；不是完整逐檔清單。

```text
App.js                                  畫面流程與根層整合
index.js                                React Native 進入點
src/
├─ app/  Launch.js、useTrackingSession.js、handleRootBack.js  啟動、追蹤工作階段與返回鍵
├─ auth/  AuthProvider.js  登入與 Session
├─ ble/  BleService.js、BleScanner.js、BleParser.js  BLE 介面、掃描與解析
├─ config/  DeviceProfiles.js  裝置設定
├─ database/  DogDatabase.js、LocalDatabases.js、SettingsDatabase.js  共用 SQLite 與偏好
├─ gps/  LocationService.js、usePhoneLocation.js  定位權限與系統定位狀態
├─ locationTracker/  LocationTrackerService.js、useLiveLocation.js、LocationTrackerScreen.js  手機背景記錄、即時快照與診斷清單
├─ map/  TrackingMap.js、GoogleTrackingMap.js、DogMerge.js  地圖介面、Google 繪圖與狗來源合併
├─ tracking/  TrackingFeed.js、DogFreshness.js、ReceiverRange.js  路線、新鮮度與接收範圍
├─ history/  HistorySources.js、HistoryTimeline.js、screen/  歷史去重、時間軸與日模型
├─ mapHistory/  HistoryScreen.js、HistoryDatabase.js、HistoryCloud.js、useHistoryExport.js  第三版歷史畫面、日期下載與匯出
├─ activity/  ActivityScreen.js、ActivityData.js、views/  活動畫面與統計
├─ alerts/  AlertEngine.js、AlertNotifications.js、useAlertEngine.js  提醒判斷與通知
├─ cloud/  CloudSync.js、CloudDatabase.js、CloudDataScreen.js  雲端下載、帳號快取與診斷
├─ cloudUpload/  UploadService.js、SearchRelay.js  BLE 轉送與搜索中繼
├─ placement/  IndoorHold.js、HoldStore.js、RideAlong.js、AddressLookup.js  室內停住、坐車與地址
├─ settings/  SettingsHome.js、PhoneSettings.js、DiagnosticsSettings.js  設定入口、手機記錄與診斷
├─ dogs/  DogProfile.js、DogAvatar.js  狗資料與頭像
├─ onboarding/  PermissionsScreen.js、PairingScreen.js、PairedScreen.js  權限、配對與已連線畫面
├─ qr/  MasterQrParser.js  QR 設定驗證
├─ screens/  MapScreen.js、LoginScreen.js  第三版即時／歷史地圖入口與登入
├─ theme/  tokens.js、ThemeProvider.js、exportPalette.js  共用樣式、主題與匯出色彩
├─ dev/  ScreenFixtures.js、useScreenFixture.js  開發畫面情境
├─ diagnostics/  DiagnosticsModel.js、useRecentRows.js  診斷資料
├─ repositories/  RealTrackingRepository.js  實際追蹤資料介面
├─ models/  DogStatus.js、TrackingPoint.js  正規化模型
├─ ml/  Environment.js、inference.js  環境推論
├─ components/  ScreenUI.js、Skeleton.js  共用畫面元件
├─ services/  supabase.js  Supabase 共用入口
└─ utils/  errors.js、haptics.js  錯誤與操作輔助

android/app/src/main/java/com/dogtracker/
├─ MainActivity.kt、MainApplication.kt    Activity 與原生模組註冊
├─ BleBackgroundModule.kt、BleBackgroundPackage.kt、BleForegroundService.kt  背景 BLE
├─ DogStatusStore.kt、BleUploadQueue.kt   共用 SQLite owner 與待傳佇列
├─ QrCameraViewManager.kt、QrScanLifecycle.kt、QrScannerPackage.kt  CameraX／ML Kit 掃描
├─ TrackingPlatformModule.kt、TrackingPlatformPackage.kt  定位狀態與操作震動橋接
├─ HistoryExportPackage.kt、ExportLifecycle.kt、ExportLabelLayout.kt、HistoryExportCleanup.kt  匯出繪圖、分享與清理
├─ PlaceLookupModule.kt                  地址查詢
├─ AlertNotificationsModule.kt、AlertNotificationsPackage.kt、NotificationChannels.kt  通知橋接
├─ alerts/  BackgroundAlerts.kt、AlertRules.kt、AlertPoster.kt、IndoorHold.kt  背景提醒與停住判斷
├─ cloud/   CloudHistoryWorker.kt、CloudSyncSchedule.kt、CloudSyncPackage.kt、SearchRelayService.kt  背景雲端工作
└─ location/  LocationTrackerService.kt、LocationTrackerStore.kt、LocationTrackerPackage.kt、LocationPipeline.kt、DisplayLocation.kt  手機定位與記錄
```

## 模組責任

| 模組 | 位置 | 責任 |
| --- | --- | --- |
| 啟動與畫面 | `App.js`、`src/app/`、`src/screens/` | 根層導航、工作階段；`MapScreen` 整合第三版即時／歷史地圖 |
| BLE／配對 | `src/ble/`、`src/onboarding/`、`src/qr/` | 掃描、配對、QR 驗證與接收器操作；原生前景服務負責 GATT、Notify、重連與保存 |
| 資料庫／模型 | `src/database/`、`src/models/`、`src/repositories/` | 共用 SQLite、偏好保存、正規化資料與追蹤讀取介面 |
| 手機定位 | `src/gps/`、`src/locationTracker/`、原生 `location/` | `usePhoneLocation` 管理權限／系統狀態；`LocationTrackerService` 控制原生定位服務，保存 recorded route、提供即時快照與診斷清單 |
| 地圖／追蹤 | `src/map/`、`src/tracking/` | `TrackingMap`／`GoogleTrackingMap` 繪圖；合併每隻狗的來源、路線、新鮮度與接收範圍 |
| 歷史／匯出 | `src/history/`、`src/mapHistory/`、原生匯出檔案 | 去重、停留／移動與日模型；`src/mapHistory/HistoryScreen.js` 提供日期、範圍、多狗游標與匯出；原生產檔與分享 |
| 活動 | `src/activity/` | 活動統計與畫面 |
| 提醒 | `src/alerts/`、原生 `alerts/` | 前景／背景提醒規則、通知與返回快照 |
| 雲端／登入 | `src/cloud/`、`src/cloudUpload/`、`src/auth/`、`src/services/`、原生 `cloud/` | 帳號隔離、下載、BLE 轉送、搜索中繼與背景排程 |
| 定位判斷 | `src/placement/`、`src/ml/` | 室內停住、坐車、環境推論與地址查詢 |
| 設定／狗資料 | `src/settings/`、`src/dogs/` | 設定、診斷入口、名字與頭像 |
| 共用 UI／開發 | `src/theme/`、`src/components/`、`src/utils/`、`src/dev/`、`src/diagnostics/`、`src/config/` | 主題、共用元件、操作輔助、畫面情境、診斷與裝置設定 |

跨模組資料應使用 `src/models/DogStatus.js` 的格式或明確介面傳遞。新增功能邏輯應放進對應模組，避免持續擴大 `App.js`。

## QR Code 設定

`parseMasterQr()` 目前接受版本 1 的 JSON：

```json
{
  "v": 1,
  "masterId": 3,
  "bleName": "DogGPS-Master3",
  "serviceUuid": "7f510001-6d9e-4e2f-a671-8f3f2d49a001",
  "profile": "default"
}
```

驗證規則：

- `v` 必須是目前支援的 QR 版本。
- `masterId` 必須是 1 至 255 的整數。
- `bleName` 必須符合 `DogGPS-MasterN` 格式。
- `serviceUuid` 必須符合 DogTracker BLE Service UUID。
- `profile` 可省略；省略時使用 `default`。

掃描成功只代表設定格式有效。連線後收到第一筆資料時，App 還會比對 QR 的 `masterId` 與 BLE payload 的 Master ID；不一致時會中止該次連線。

## 共用 DogStatus 模型

BLE 原始資料由 `toDogStatus()` 正規化。UI 與資料庫應使用 camelCase 欄位，不直接依賴 BLE 精簡鍵：

```text
masterId, slaveId, slaveLat, slaveLon, masterLat, masterLon
distanceMeters, speedKmh, satellites, hdop
activity, activityValid, rssi, snr
batteryMillivolts, batteryPercentage, batteryValid
masterBatteryMillivolts, masterBatteryPercentage, masterBatteryValid
gpsTime, activityTime, type, sequence, length
```

## BLE 通訊協定

| 項目 | 值 |
| --- | --- |
| 裝置名稱 | `DogGPS-MasterN`，由裝置 QR 設定提供 |
| Service UUID | `7f510001-6d9e-4e2f-a671-8f3f2d49a001` |
| Data Characteristic UUID | `7f510002-6d9e-4e2f-a671-8f3f2d49a001` |
| Wi-Fi Config Characteristic UUID | `7f510003-6d9e-4e2f-a671-8f3f2d49a001` |
| 資料方向 | Master Notify 至手機 |

Master 傳送精簡 OLED dataset，現有鍵值包括：

```text
slat/slon       Slave 座標
mlat/mlon       Master 座標
dst             距離（公尺）
spd             速度（km/h）
sat/hd          衛星數／HDOP
act/av          活動／活動有效旗標
bmv/bp/bv       Slave 電池 mV／百分比／有效旗標
mbmv/mbp/mbv    Master 電池 mV／百分比／有效旗標
rssi/snr        LoRa 訊號品質
gt/at           GPS／活動時間
```

BLE Data Characteristic 應只有一個 publisher。Master 端由 OLED task 發布完整 dataset，避免長短 JSON 同時 Notify 造成封包競爭。

## BLE 連線與程序復原

Android 的 React Native BLE 層只負責掃描。選定裝置後，Kotlin 前景服務負責 GATT 連線、Notify、Wi-Fi 指令、重連及 SQLite 存檔，不依賴 JS 存活。畫面分別讀取服務執行、訂閱連線、最近資料狀態，並顯示實際接收時間；詳見 [背景 BLE 實作與驗證](BACKGROUND_BLE.md)。

前景服務採用 `START_STICKY`。Android 殺死並重建程序／服務後，服務會讀取已保存的工作階段，直接依裝置 ID 建立 GATT、探索服務、寫入 CCCD 並恢復 Notify。失敗或斷線時會以 2、4、8、16、30 秒（上限 30 秒）持續重試；藍牙關閉時每 30 秒重試。

選擇「停止背景接收」會：

- 停止 JS 層掃描、Notify 與重連計時器。
- 取消目前 BLE 連線。
- 停止前景服務及通知。
- 清除背景服務的自動恢復旗標。

首頁返回鍵規則：

- 設定的子頁（含 進階 → 接收器 Wi-Fi、診斷 → 即時資料）按返回回到上一層。
- 位於功能選單時返回掃描首頁。
- 掃描首頁若 BLE 已連線或背景服務已啟動，將 App 移至背景。
- 掃描首頁若未連線且背景服務未啟動，顯示退出確認。

## Wi-Fi 指令

Wi-Fi Config Characteristic 使用 write-with-response，裝置收到 UTF-8 JSON；原生直接傳送位元組，BLE PLX 備援路徑以 Base64 傳給函式庫再解碼送出：

```json
{"action":"upsert","ssid":"network-name","password":"network-password"}
{"action":"remove","ssid":"network-name"}
{"action":"list","offset":0}
```

`list` 可能以 `next` 分頁，App 會持續查詢直到 `next` 為空。相容 Master 韌體必須讓 Wi-Fi Config Characteristic 可讀寫。

## SQLite 保存策略

- 資料庫：`dogtracker.sqlite`
- 資料表：`dog_status`
- Android 原生每隻 Slave 每 1 秒最多保存一次；JS 備援由 device profile 控制。
- 每個 Slave 最多保留 10,000 筆狀態。
- Android 原生每次寫入交易內清理該 Slave 的超額紀錄；JS 備援每 100 次寫入清理一次。
- 查詢筆數限制為 1 至 1,000 筆。

## Android 權限

- Android 12+：`BLUETOOTH_SCAN`、`BLUETOOTH_CONNECT`
- Android 11 以下：`BLUETOOTH`、`BLUETOOTH_ADMIN`、`ACCESS_FINE_LOCATION`
- 前景 BLE：`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_CONNECTED_DEVICE`
- Android 13+ 通知：`POST_NOTIFICATIONS`
- QR 掃描：`CAMERA`

## 開發

需求：

- Windows
- Node.js `>= 22.11.0`
- Android SDK、Platform Tools 與 JDK
- React Native `0.87.0`

安裝相依套件：

```powershell
npm install
```

啟動 Metro 並執行 USB Debug 版本：

```powershell
npm start
adb devices
adb reverse tcp:8081 tcp:8081
npm run android
```

Debug APK 需要 Metro。需要離線啟動時必須建置 Release APK。

## 測試、Release 與手機安裝

```powershell
npm run lint
npm test -- --runInBand

cd android
.\gradlew assembleRelease
cd ..

adb install -r android\app\build\outputs\apk\release\app-release.apk
```

Release APK：

```text
android\app\build\outputs\apk\release\app-release.apk
```

目前 Release build 使用 debug keystore 簽署，只適合開發及內部測試；正式發布前應建立並安全管理 production keystore。

## Git 協作

每項功能使用獨立分支：

```powershell
git switch -c feature/task-name
git status
git add <files>
git commit -m "feat: describe the change"
git push -u origin feature/task-name
```

合併至 `main` 前應執行 lint 與測試。變更 BLE、Android 權限、Kotlin 原生模組、CameraX 或 ML Kit 時，也應完成 Release build 並在實機驗證。
