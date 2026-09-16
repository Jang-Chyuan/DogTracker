# 雲端資料與增量同步

入口：DogTracker → 設定 → 雲端資料。

1. 使用 Supabase Auth 中已建立並獲授權的 Email／密碼登入一次。
2. 自動同步每個已授權 Master 的最近 24 小時；每 30 秒下載增量。Android 登入後啟動常駐通知服務，切到地圖、其他 App 或鎖屏仍保留同步排程。
3. 較早資料：填台灣日期範圍（可指定 Master），按「下載到手機」。每批最多 500 筆，直到範圍內沒有後續資料。
4. 在下方查看本機紀錄，每頁 50 筆。重新讀取本機資料不使用網路。

## 設定與授權

`CloudConfig.js` 只包含 Project URL 與可公開的 Publishable Key，已從 PC 工具的相應設定移入；不使用 Secret Key、資料庫密碼或裝置 Token。

雲端來源為 `public.dog_telemetry`，不是 `dog_telemetry_taiwan` View。
Supabase 必須啟用 RLS，並允許 authenticated SELECT，使用以下條件授權：

```sql
exists (
  select 1 from public.device_members m
  where m.user_id = (select auth.uid())
    and m.gateway_id = ('master_' || dog_telemetry.master_id::text)
)
```

`telemetry_member_guard` 與 `telemetry_member_read` 均需移除 Slave 篩選；會員表使用 `device_members_read_self`。本模組不修改線上政策，也不提供自行新增授權的功能。

## 本機資料

沿用 `dogtracker.sqlite` 的 `supabase_dog_status`。使用既有共享連線與 Android 原生 SQL 橋接；不開啟第二個 SQLite 引擎。

整張 `supabase_dog_status` 最多保留最新 15,000 筆（所有帳號與 Master 合計），依 `received_at DESC, id DESC` 排序。初始化與每批寫入都會清除超額的較早紀錄；同步進度及 BLE 表不受影響。已達上限時，手動下載更早的紀錄可能立即被清除。

首次使用雲端儲存時，會增加 `owner_user_id`、`event_id`、`downloaded_at`、`remote_received_at`，並建立 `(owner_user_id, event_id)` 唯一索引。沒有帳號歸屬的舊資料不會顯示。每個帳號只顯示自己的快取。

GPS、速度、HDOP、活動值依韌體比例換算。`received_at` 存 Unix 毫秒；分頁使用原始雲端時間及 UUID，保留微秒精度。`raw_payload` 保存整筆雲端 JSON。Slave GPS／活動時間保留原始值，未推定時間基準。

## 登入持久化與同步進度

Session 透過 `react-native-keychain` 存於 Android Keystore／iOS Keychain，包含更新登入所需的 Token，不保存 Email 登入密碼。SDK 自動更新 Token。重啟 App 會恢复 Session；Session 被撤銷或失效仍需重新登入。升級前的版本只存記憶體，因此本次升級需重新登入一次。

`cloud_sync_state` 以 `(owner_user_id, master_id)` 為主鍵，儲存 `through_at`、`event_id`、`updated_at`。每批事件與對應進度在同一個 SQLite transaction 提交；若該範圍已讀完，進度移至本輪查詢上限，事件 ID 為空。首次即使尚無資料也會記錄起始範圍。手動下載不改動此進度。

每輪重新讀取 `device_members`，新獲授權的 Master 首次抓最近 24 小時；原有 Master 從上次進度前 5 分鐘補查，利用事件唯一鍵去重。分頁保留微秒時間精度。中斷後再開 App 會從保存進度補下載，不只抓當天。

排程在 App 層執行，不依賴雲端頁。每 30 秒觸發，上一輪未完成就略過。斷網失敗下個週期重試。每輪自動同步最多執行 120 秒，逾時保留已儲存批次，下輪繼續。手動下載會先取消並等待自動下載停止，兩者不重疊。登出取消同步並清除該手機的 Session。

Android 的 `CloudBackgroundService` 使用 dataSync 前景服務與一個 Headless JS 保活任務，維持同一個 JS 同步器及 Token 更新，不建立第二套下載器或資料庫。通知顯示最近成功同步時間。登入並處於前景時啟動服務；登出或 App 同步 owner 卸載時停止。Headless 任務結束時釋放喚醒鎖。服務啟動失敗時顯示錯誤並退回僅前景同步。iOS 維持僅前景同步。

Android 15+ 的 dataSync 服務受背景執行時數限制；時限到達會停止服務及背景排程，回到 App 後恢復。系統強制停止、廠商省電或 Doze 網路限制可能中斷／延遲排程；本版不提供被殺掉後的無介面自動重啟或開機啟動，下次開啟依 SQLite 進度補下載。OPPO 如限制背景運作，需在系統的 App 電池設定允許 DogTracker 背景活動。不要宣稱背景每 30 秒必定收到新資料。

5 分鐘補查只涵蓋有限的延遲寫入；雲端若回填更舊的時間，需手動下載該日期補齊。假設雲端 `received_at` 為新增時的接收時間，手機時鐘正確。

## 範圍與限制

- Android 常駐通知服務運作期間可背景同步；登入後可以離線查看已下載的快取。
- 手動下載採固定日期範圍與當次操作時間上限，較早歷史仍使用此入口。
- 假設雲端事件為追加且不可變；相同事件重複下載不新增，不更新已下載事件，也不同步刪除。
- 取消／失敗保留已提交批次；可再次下載相同範圍去重補齊。離開雲端頁只會取消手動下載，自動同步繼續。
- 登出隱藏本機快取；帳號切換隔離顯示。雲端撤銷 Master 授權不會自動刪除以前合法下載的離線資料。
- 本機表格目前提供常用解析欄位，不將雲端資料接入 BLE 地圖。

## 驗證

```powershell
npm.cmd test -- --runInBand __tests__/Cloud.test.js __tests__/CloudScreen.test.js __tests__/CloudSync.test.js __tests__/CloudBackground.test.js
```

實機驗收：已授權帳號讀取對應 Master 全部 Slave；無授權帳號下載為空；相同範圍下載兩次筆數不增加；斷網後重新讀取本機資料；取消後重試；登出與換帳號不顯示前一帳號資料。

同步驗收：登入後自動下載及出現常駐通知；切到地圖、桌面或鎖屏超過 30 秒後查看通知的成功同步時間及新資料；殺掉 App 重開不需輸入密碼並補下載；登出後服務與喚醒鎖停止；斷網再連線後下一週期重試；手動下載舊歷史不倒退自動進度。Android 原生服務變更需要重新建置安裝 APK；iOS 套件更新需更新 Pods 並重建。

目前兩個已知帳號皆有 Master 5／7 授權，需另外使用無授權帳號驗證拒絕讀取。不能以 postgres 或 Secret Key 測試使用者 RLS。
