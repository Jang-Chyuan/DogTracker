# Android 背景 BLE

Android 的掃描使用 BLE PLX；選定裝置後，由 `BleForegroundService` 獨占 GATT，負責 MTU、Notify、Wi-Fi 指令、斷線重連及 SQLite 存檔。JS 不再建立第二條 GATT，也不重複寫入收到的資料。

服務只在 CCCD 訂閱成功後回報 connected。接收完整 JSON 後先寫入 `files/databases/dogtracker.sqlite`，再通知畫面。即使 React runtime 不存在，仍執行原生存檔；歷史頁也經原生模組讀取相同資料庫，保留升級前紀錄。每隻 Slave 每秒最多一筆，最多保留 10,000 筆。存檔錯誤另行顯示，不假裝存檔成功。

服務在獨立 HandlerThread 處理 GATT 與資料；忽略已關閉連線的延遲 callback。連線／訂閱逾時 30 秒，失敗依 2–30 秒退避重連。30 秒沒有完整資料會顯示等待；90 秒沒有資料則重建 GATT。Wi-Fi 指令使用相同 GATT，等待 callback 完成，10 秒逾時。QR 的 Master ID 驗證也在原生存檔之前執行。

畫面在前景每 2 秒及返回 App 時讀取服務狀態。`running`、`connected`、`receiving` 分開判斷；最後資料顯示真正接收時間，恢復快取不會刷新時間或再存一次。`START_STICKY` 重建服務會讀回連線設定；使用者停止則關閉自動恢復。

`MainActivity.onResume()` 在使用者重新開啟或返回 App 時檢查保存的 `enabled` 旗標。若仍啟用、BLE 位址及 UUID 完整，且服務尚未執行，便送出 `ACTION_RESUME`，直接使用既有設定重連；保留 Master ID 驗證、sessionId、最後資料與接收時間。已執行的服務不重複啟動，手動停止後不會自動恢復。Android 12+ 恢復前檢查藍牙連線權限；權限不足時顯示恢復錯誤。

2026-09-07 在 OPPO CPH1920 設定 DogTracker：耗電保護改為「允許背景執行」、開啟「允許自動啟動」、最近使用 App 卡片設為「鎖定」（已確認卡片鎖頭）。這些是手機端設定，不會隨 APK 自動套用到其他手機，也不保證攔下所有系統強制停止。

同日實測強制停止後重新啟動 App，系統確認 `com.dogtracker.ble.RESUME` 前景服務自動建立，沿用 Master5，最後資料時間仍為 03:24:57，沒有把快取當成新資料。當時掃描僅找到 Master3，Master5 尚未重新連上；本次不宣稱完成 Master5 收資料或整夜清理保護驗證。

驗證：

```powershell
npm.cmd run lint
npm.cmd test -- --runInBand
cd android
.\gradlew.bat :app:testDebugUnitTest :app:assembleRelease
```

實機驗收需開啟 Master：連線後查看資料表，切背景並鎖屏數分鐘，再返回確認接收時間連續增加；關閉再開啟 Master 或藍牙，確認斷線狀態及原生重連；停止接收後確認通知消失且紀錄停止增加。系統強制停止 App 不屬於 `START_STICKY` 可保證恢復的範圍，仍需使用者重新開啟。

2026-09-06 實測：OPPO CPH1920（Android 8.1），Master5、Slave4／Slave6。11:51:08 切到背景並關屏，11:51:48 由系統確認 `mAwake=false`、`screenState=0`，11:52:28 返回 App。SQLite 顯示關屏期間新增的紀錄，包括 11:51:52、11:51:55、11:52:04、11:52:26；既有歷史資料仍可讀取。Android 8.1 的 PRAGMA 初始化相容性問題修正後，接收與存檔錯誤已消失。此測試未涵蓋長時間深度休眠、系統殺程序、自動重連及 Wi-Fi 實機操作。

自動驗證通過：ESLint、7 項 Jest 測試、4 項原生封包單元測試、Release APK 建置。最後修正版已安裝至上述 OPPO。
