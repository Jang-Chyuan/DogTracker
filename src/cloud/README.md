# 雲端資料與增量同步

入口：DogTracker → 設定 → 雲端資料。

1. 使用 Supabase Auth 中已建立並獲授權的 Email／密碼登入一次。
2. 首次同步每個已授權 Master 的最近 24 小時；前景每 30 秒下載增量，Android 背景／鎖屏每 15 分鐘由 WorkManager 排程，回到 App 先顯示本機歷史並立即補下載。
3. 在下方查看本機紀錄，每頁 50 筆。重新讀取本機資料不使用網路。
4. 手動下載入口已移除；已下載的較早資料仍可查看，未下載的舊資料目前沒有日期範圍補下載入口。

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

整張 `supabase_dog_status` 以**容量**為上限：`CLOUD_BUDGET_BYTES` 500 MB，換算成 `CLOUD_MAX_ROWS`（實測此 schema 加四個索引，有原始 JSON 是 797 B／筆、沒有是 541 B／筆，取 560 B 估算，約 93 萬筆），依 `received_at DESC, id DESC` 排序保留最新的。初始化與每批寫入都會清除超額的較早紀錄，與資料及進度同一個交易；同步進度及 BLE 表不受影響。

原本的上限是 15,000 筆（約 11 MB）。一隻狗一天就約 14,000 筆，等於下載過的日子隔天就被清掉——這正是使用者遇到的狀況，所以改成容量上限。`raw_payload`（整筆雲端 JSON）只保留 `CLOUD_PAYLOAD_MS` 一天，之後清成 NULL：它佔 32% 的容量，而其他欄位早就各自存成欄位了。清除 payload 每次約 50 ms（要讀資料列），所以每 20 批才做一次；清除超額資料約 9 ms，維持每批都做。`usage()` 回報目前筆數與估算容量，顯示在雲端資料頁。

首次使用雲端儲存時，會增加 `owner_user_id`、`event_id`、`downloaded_at`、`remote_received_at`，並建立 `(owner_user_id, event_id)` 唯一索引。沒有帳號歸屬的舊資料不會顯示。每個帳號只顯示自己的快取。

GPS、速度、HDOP、活動值依韌體比例換算。`received_at` 存 Unix 毫秒；分頁使用原始雲端時間及 UUID，保留微秒精度。`raw_payload` 保存整筆雲端 JSON。Slave GPS／活動時間保留原始值，未推定時間基準。

## 登入持久化與同步進度

Session 透過 `react-native-keychain` 存於 Android Keystore／iOS Keychain，包含更新登入所需的 Token，不保存 Email 登入密碼。SDK 自動更新 Token。重啟 App 會恢复 Session；Session 被撤銷或失效仍需重新登入。升級前的版本只存記憶體，因此本次升級需重新登入一次。

`cloud_sync_state` 以 `(owner_user_id, master_id)` 為主鍵，儲存 `through_at`、`event_id`、`updated_at`。每批事件與對應進度在同一個 SQLite transaction 提交；若該範圍已讀完，進度移至本輪查詢上限，事件 ID 為空。首次即使尚無資料也會記錄起始範圍。

每輪重新讀取 `device_members`，新獲授權的 Master 首次抓最近 24 小時。已完成的下載範圍從上次進度前 5 分鐘補查，利用事件唯一鍵去重；未完成的範圍用最後提交的微秒 `received_at` 加 `event_id` 精確續傳，避免有限批次一直停在同一頁。增量游標不使用 `phone_received_at`；歷史顯示維持修正後的 `track_at`。

排程在 App 層執行，不依賴雲端頁。每 30 秒觸發，上一輪未完成就略過。斷網失敗下個週期重試。每輪自動同步最多執行 120 秒，逾時保留已儲存批次，下輪繼續。登出取消同步並清除該手機的 Session。

Android 登入後排定唯一的 WorkManager periodic work `dogtracker-cloud-history`，15 分鐘週期、首次延遲 15 分鐘，重複 Token 更新不重設排程。`NetworkType.CONNECTED` 讓無網路時等待；執行中斷網會停止工作，保留已提交的頁面，系統允許後再續傳。暫時性錯誤採 2 分鐘起的指數退避。背景先批次轉送 BLE 待傳資料（最多 30 秒，沿用 UUID、每筆檢查登入帳號及 Master 轉送設定），再執行增量下載；整輪最多 90 秒，不跑前景的整點核對／舊時間修復。前景與背景共用上傳鎖，回到前景或登出會取消背景請求；取消後未確認的事件留待重試。排程可能受 Android 省電影響延後，並非背景即時上傳。

`CloudHistoryWorker` 在 ReactHost 啟動後執行一次 `DogTrackerCloudHistory` Headless JS：JS 最多 90 秒、每台 Master 最多 4 頁（每頁最多 1,000 筆），原生端另有限時等待。結束即釋放工作，不新增常駐 dataSync 服務，也不使用無限 Headless JS／常駐喚醒鎖。背景借用同一個 Android SQLite 引擎；下載、初始化及平滑快取寫入有共用鎖。

WorkManager 不保存 JWT，執行時從既有安全儲存恢復並更新 Session。工作綁定帳號及排程世代，登出會取消排程與正在執行的工作，換帳號不沿用舊工作。回到前景中止背景請求，先讀本機歷史，同時啟動前景補下載；兩者共用下載鎖，不同時寫入同步進度。歷史畫面不等待網路，並維持本機 10 秒更新。

15 分鐘是系統排程週期，不是精準鬧鐘：Doze、廠商省電或系統配額會延後工作。程序被回收後可由 WorkManager 重啟；使用者「強制停止」後需要重新開啟 App。iOS 仍僅前景同步。

5 分鐘補查只涵蓋有限的延遲寫入。Master 離線暫存後補傳、Master 與手機時鐘不一致時，資料寫入雲端時的 `received_at` 可能已早於同步進度，這種資料改由下面的整點核對找回。

## 整點核對（每 10 分鐘）

自動同步完成後，若距上次核對已超過 10 分鐘，對每台授權 Master 檢查最近 24 個**已結束**的整點小時（含 `now` 的那一小時仍在增加，交給每 30 秒的增量同步）。

每個小時先向雲端要「筆數」（`count: exact`、`head: true`，不下載內容）：

- 與 `cloud_sync_buckets` 上次核對到的筆數相同 → 跳過。
- 不同或沒有紀錄 → 比對本機該小時的筆數；本機較少才重新掃描該小時（每批 1,000 筆、以 `event_id` 去重），然後把雲端筆數記進 `cloud_sync_buckets`。
- 沒有紀錄、但 `cloud_sync_state` 的進度已經走過那個小時 → 直接記下目前雲端筆數，不重新下載。增量同步當時已經抓過整個小時，本機筆數較少只是被保留規則刪掉；不這樣做的話，快取已滿的手機第一次核對會把整天重抓一遍。那之後才進來的資料仍會讓筆數改變，由下一輪核對補抓。

`cloud_sync_buckets` 以 `(owner_user_id, master_id, bucket_start)` 為主鍵，保存**雲端**筆數，不是本機筆數：本機容量上限會刪掉較早的資料，若拿本機筆數當基準，同一小時會每輪重複下載。保留 48 小時的核對紀錄。核對掃描不使用 checkpoint，因此不會移動 `cloud_sync_state` 的自動同步進度；取消、逾時或失敗時已記錄的小時保留，下一輪從未核對的小時繼續。

每輪每台 Master 最多 24 次筆數查詢；沒有補傳時不會下載任何資料。核對只涵蓋最近 24 小時，更早的延遲補傳目前不提供手動補下載入口。

## 範圍與限制

- 前景每 30 秒；Android 背景／鎖屏由 WorkManager 每 15 分鐘排程。登入後可以離線查看已下載的快取。
- 雲端頁只提供登入、自動同步狀態及本機資料查閱，不提供手動下載。
- 假設雲端事件為追加且不可變；相同事件重複下載不新增，不更新已下載事件，也不同步刪除。
- 同步中斷／失敗保留已提交批次，下輪依進度補齊。離開雲端頁但仍在 App 前景時，自動同步繼續。
- 登出隱藏本機快取；帳號切換隔離顯示。雲端撤銷 Master 授權不會自動刪除以前合法下載的離線資料。
- 本機表格目前提供常用解析欄位，不將雲端資料接入 BLE 地圖。

## 首頁的狗 marker

`slave_id` 全隊唯一，所以首頁每隻狗只有一個 marker，取 BLE 與各台 Master 的雲端資料中**最新的一筆**，並標示來源（`BLE` 或 `經 Master N・雲端`）。合併規則在 `src/map/DogMerge.js`，不依賴地圖 SDK。

- 地圖只讀本機 `supabase_dog_status`（`latestBySlave`，每 10 秒一次），不直接查 Supabase；離線仍可顯示已下載的位置。
- BLE 最後一筆在 10 分鐘內視為連線中：只顯示該 Master 收到的狗，只在雲端的狗仍隱藏。BLE 沉默超過 10 分鐘就改以雲端為準，顯示雲端有的每隻狗（挑選介面另計）。
- 同一時間的兩筆保留 BLE，因為那是手機自己的時鐘；雲端的時間來自 Master。
- 超過 24 小時的位置不放 marker。沒有有效座標的資料不能當最新位置。
- Demo 模式與未登入不讀雲端資料。

BLE 是手機收到的時間、雲端是 Master 收到的時間，兩個時鐘不同；Master 時鐘來源未確認前，「哪筆最新」的判斷仍可能受時鐘誤差影響。

## 驗證

```powershell
npm.cmd test -- --runInBand __tests__/Cloud.test.js __tests__/CloudScreen.test.js __tests__/CloudSync.test.js __tests__/CloudForeground.test.js __tests__/CloudReconcile.test.js
```

實機驗收：已授權帳號讀取對應 Master 全部 Slave；無授權帳號下載為空；重複同步筆數不增加；斷網後重新讀取本機資料；登出與換帳號不顯示前一帳號資料；確認頁面沒有手動下載、日期或 Master 篩選欄位。

核對驗收：登入後等待首次核對完成（約 10 分鐘內），在雲端資料頁確認筆數不因核對而重複增加；讓 Master 離線後再連線補傳較早的資料，等待下一次核對，確認補傳的資料出現在本機；連續觀察數輪，確認沒有補傳時不會重複下載。

同步驗收：登入後前景每 30 秒；以 `adb shell dumpsys jobscheduler` 檢查 `com.dogtracker/androidx.work.impl.background.systemjob.SystemJobService` 的週期與網路條件。切到桌面／鎖屏後觀察工作結束（Logcat tag `CloudHistoryWorker`），本機資料增加且工作之間不持續持有喚醒鎖。斷網工作等待，恢復後續傳；回到前景即讀本機歷史並補下載；登出後排程取消。另驗收程序被系統回收後的冷啟動、帳號切換及長時間 Doze。Android 原生變更需要重新建置安裝 APK。

目前兩個已知帳號皆有 Master 5／7 授權，需另外使用無授權帳號驗證拒絕讀取。不能以 postgres 或 Secret Key 測試使用者 RLS。

「雲端資料」頁的列表可以點任一列展開該筆的**原始雲端 JSON**（下載時就存在 `raw_payload`）。欄位表只有 App 讀得到的欄位，原始紀錄才看得出 payload 還帶了什麼——例如 Master 自己的座標（硬體問題 H2）。
