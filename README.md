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

## 使用流程

1. 開啟 App 並允許必要權限。
2. 點選「自動 BLE QR Code 掃描」，將裝置 QR Code 對準相機；也可以選擇「手動 BLE 掃描」。
3. App 驗證 QR 內容後，依其中的 Master ID、BLE 名稱與 UUID 尋找並連接裝置。
4. 連線成功後查看即時資料，或進入 Wi-Fi 設定及資料表畫面。
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
src/screens/                        Wi-Fi 與資料畫面
src/database/                       SQLite 儲存
src/models/DogStatus.js             共用資料模型
android/app/src/main/java/com/dogtracker/
  BleForegroundService.kt           BLE 前景服務及程序復原
  QrScannerActivity.kt              CameraX／ML Kit QR 掃描器
```

更完整的 BLE 協定、模組分工與協作規則請參閱 [PROJECT_GUIDE.md](PROJECT_GUIDE.md)。
