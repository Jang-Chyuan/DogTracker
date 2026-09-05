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

## 專案結構

```text
App.js                                  畫面流程、BLE 即時狀態與返回鍵行為
index.js                                React Native 進入點
src/
├─ ble/
│  ├─ BleService.js                     權限、掃描、連線、重連與 Wi-Fi 指令
│  ├─ BleScanner.js                     BLE 掃描器
│  └─ BleParser.js                      Base64／BLE payload 解析
├─ config/
│  └─ DeviceProfiles.js                 裝置顯示與資料保存設定
├─ database/
│  └─ DogDatabase.js                    SQLite schema、寫入、查詢與清理
├─ gps/
│  └─ LocationService.js                手機定位介面（預留）
├─ map/
│  └─ DogMap.js                         地圖介面（預留）
├─ models/
│  └─ DogStatus.js                      共用正規化資料模型
├─ qr/
│  └─ MasterQrParser.js                 QR 設定格式與安全驗證
└─ screens/
   ├─ DataTableScreen.js                SQLite 資料表檢視
   ├─ WifiSettingsScreen.js             Master Wi-Fi 管理
   ├─ MapScreen.js                      地圖畫面（預留）
   └─ HistoryScreen.js                  歷史畫面（預留）

android/app/src/main/java/com/dogtracker/
├─ BleBackgroundModule.kt               React Native 與前景服務橋接
├─ BleBackgroundPackage.kt              BLE 原生模組註冊
├─ BleForegroundService.kt              GATT 復原、Notify 與原生重連
├─ QrScannerActivity.kt                 CameraX／ML Kit 掃描畫面
├─ QrScannerModule.kt                   QR Scanner Promise 橋接
└─ QrScannerPackage.kt                  QR 原生模組註冊
```

## 模組責任

| 模組 | 位置 | 責任 |
| --- | --- | --- |
| BLE | `src/ble/` | 權限、掃描、GATT 連線、Notify、Wi-Fi 指令與 JS 層重連 |
| QR | `src/qr/`、Android 原生 Scanner | 相機辨識、QR 格式驗證與裝置設定 |
| 資料庫 | `src/database/` | SQLite schema、狀態保存、歷史查詢與容量清理 |
| UI | `App.js`、`src/screens/` | 畫面狀態、裝置操作、Wi-Fi 與資料表 |
| 原生背景 BLE | Android Kotlin | 前景通知、工作階段保存、程序復原與原生 GATT 重連 |
| GPS／Map | `src/gps/`、`src/map/` | 後續手機定位及地圖功能 |

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

正常連線期間，React Native BLE 層負責掃描、連線、初次讀取、Notify 及 Wi-Fi 指令；同時將裝置 ID、顯示名稱、Service UUID 與 Data UUID 傳給 Kotlin 前景服務保存。

前景服務採用 `START_STICKY`。Android 殺死並重建程序／服務後，服務會讀取已保存的工作階段，直接依裝置 ID 建立 GATT、探索服務、寫入 CCCD 並恢復 Notify。失敗或斷線時會以 2、4、8、16、30 秒（上限 30 秒）持續重試；藍牙關閉時每 30 秒重試。

選擇「停止背景接收」會：

- 停止 JS 層掃描、Notify 與重連計時器。
- 取消目前 BLE 連線。
- 停止前景服務及通知。
- 清除背景服務的自動恢復旗標。

首頁返回鍵規則：

- 位於 Wi-Fi 或資料表畫面時返回功能選單。
- 位於功能選單時返回掃描首頁。
- 掃描首頁若 BLE 已連線或背景服務已啟動，將 App 移至背景。
- 掃描首頁若未連線且背景服務未啟動，顯示退出確認。

## Wi-Fi 指令

Wi-Fi Config Characteristic 使用 write-with-response，內容為 Base64 編碼的 UTF-8 JSON：

```json
{"action":"upsert","ssid":"network-name","password":"network-password"}
{"action":"remove","ssid":"network-name"}
{"action":"list","offset":0}
```

`list` 可能以 `next` 分頁，App 會持續查詢直到 `next` 為空。相容 Master 韌體必須讓 Wi-Fi Config Characteristic 可讀寫。

## SQLite 保存策略

- 資料庫：`dogtracker.sqlite`
- 資料表：`dog_status`
- 預設每 1 秒最多保存一次（由 device profile 控制）。
- 每個 Slave 最多保留 10,000 筆狀態。
- 每累積 100 次寫入後執行一次舊資料清理。
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

## 預留功能

- `src/gps/LocationService.js`：手機 GPS provider
- `src/map/DogMap.js`：地圖元件
- `src/screens/MapScreen.js`：地圖畫面
- `src/screens/HistoryScreen.js`：完整歷史查詢畫面
