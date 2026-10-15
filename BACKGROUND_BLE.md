# Android 背景 BLE

Android 的掃描使用 BLE PLX；選定裝置後，由 `BleForegroundService` 獨占 GATT，負責 MTU、Notify、Wi-Fi 指令、斷線重連及 SQLite 存檔。JS 不再建立第二條 GATT，也不重複寫入收到的資料。

服務只在 CCCD 訂閱成功後回報 connected。接收完整 JSON 後先寫入 `files/databases/dogtracker.sqlite`，再通知畫面。即使 React runtime 不存在，仍執行原生存檔；歷史頁也經原生模組讀取相同資料庫，保留升級前紀錄。每隻 Slave 每秒最多一筆，最多保留 10,000 筆。存檔錯誤另行顯示，不假裝存檔成功。

每筆 Notify 在 GATT callback 收到的當下就記下時間（`Arrival`），之後才排進 HandlerThread 和資料庫：資料庫忙著時排隊的封包仍保留各自的接收時間，每秒一筆的節流不會把它們當成同一秒丟掉。

拼接 JSON 時（`BleJsonFramer`），一筆被截斷的 Notify（超過 MTU 或漏掉片段）不再讓後面的封包全部卡在未關閉的物件裡：已有未完成的物件時，若新的 Notify 以 `{` 開頭，而且它本身就是完整的物件，或距離上一段 ≥ 500 ms，就丟掉舊的半筆重新開始（`framerResyncs`）。接收器封包是沒有巢狀的扁平 JSON，同一筆的片段會連續送達，所以不會誤切。要求 MTU 320，協商結果與狀態記錄下來（小於 320 或失敗時寫 log）；`getState()` 與 `adb shell dumpsys activity service com.dogtracker/.BleForegroundService` 可看到 `mtu`、最長一筆 `largestFrame`、`framerResyncs`、`framesWithoutMasterId`，只含次數，不含位置。

服務在獨立 HandlerThread 處理 GATT 與資料；忽略已關閉連線的延遲 callback。連線／訂閱逾時 30 秒，失敗依 2–30 秒退避重連。30 秒沒有完整資料會顯示等待；90 秒沒有資料則重建 GATT。Wi-Fi 指令使用相同 GATT，等待 callback 完成，10 秒逾時。QR 的 Master ID 驗證也在原生存檔之前執行。

畫面在前景每 2 秒及返回 App 時讀取服務狀態。`running`、`connected`、`receiving` 分開判斷；最後資料顯示真正接收時間，恢復快取不會刷新時間或再存一次。`START_STICKY` 重建服務會讀回連線設定；使用者停止則關閉自動恢復。

`MainActivity.onResume()` 在使用者重新開啟或返回 App 時檢查保存的 `enabled` 旗標。若仍啟用、BLE 位址及 UUID 完整，且服務尚未執行，便送出 `ACTION_RESUME`，直接使用既有設定重連；保留 Master ID 驗證、sessionId、最後資料與接收時間。已執行的服務不重複啟動，手動停止後不會自動恢復。Android 12+ 恢復前檢查藍牙連線權限；權限不足時顯示恢復錯誤。

部分廠商（例如 OPPO／ColorOS）會積極停止背景程式。需要在手機上手動設定：耗電保護改為允許背景執行、開啟允許自動啟動，並把最近使用 App 的卡片鎖定。這些是每支手機的設定，不會隨 APK 套用，也不保證擋下所有系統強制停止。

驗證：

```powershell
npm.cmd run lint
npm.cmd test -- --runInBand
cd android
.\gradlew.bat :app:testDebugUnitTest :app:assembleRelease
```

實機驗收需開啟 Master：連線後查看資料表，切背景並鎖屏數分鐘，再返回確認接收時間連續增加；關閉再開啟 Master 或藍牙，確認斷線狀態及原生重連；停止接收後確認通知消失且紀錄停止增加。系統強制停止 App 不屬於 `START_STICKY` 可保證恢復的範圍，仍需使用者重新開啟。
