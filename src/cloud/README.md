# 雲端資料與增量同步

入口：DogTracker → 設定 → 雲端資料。

1. 使用 Supabase Auth 中已建立並獲授權的 Email／密碼登入一次。
2. 首次同步每個已授權 Master 的最近 24 小時；前景每 30 秒下載增量，Android 背景／鎖屏每 15 分鐘由 WorkManager 排程，回到 App 先顯示本機歷史並立即補下載。
3. 在下方查看本機紀錄，每頁 50 筆。重新讀取本機資料不使用網路。
4. 雲端診斷頁沒有手動下載入口；已下載的較早資料仍可查看。歷史畫面的日期列／月曆可補下載指定日期，由 `HistoryCloud`、`useHistoryCloud` 寫入同一份本機快取。

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

Token 更新失敗但伺服器沒有拒絕登入時（剛回前景網路未通、5xx，或 SDK 在背景更新失敗後 60 秒內不再重試），SDK 的 `getSession()` 回報沒有 Session，請求會改用 publishable key 匿名送出並得到 401。所以前景每輪最新位置先等 SDK 拿到同一帳號的 Session（最多 65 秒，期間仍顯示「正在更新」）再送第一個請求；遇到 401 時強制更新 Token 一次並重送一次（`CloudSession.js`）。伺服器拒絕 Refresh Token 時照舊回報登入失效，不重試。

更新 Token 的回應不是 Supabase 自己的判定時，一律當成連不上（`CloudRefreshGuard.js`）：Wi-Fi 登入頁或代理伺服器的 HTML、429、任何 5xx、其他狀態碼。SDK 只把丟出的 fetch 錯誤和 502／503／504 當成可重試；其他回應在 Access Token 已過期時（例如在背景超過一小時後回到 App）會讓 SDK 刪掉存好的登入並發出 `SIGNED_OUT`，App 就顯示登入失效、BLE 轉送也停了。只有 Supabase 的 JSON 400／401／403（Refresh Token 被撤銷、已用過、Session 不存在）才照舊結束登入。

一次失敗（`error`、`authFailed`）保留到下一次成功才清除，不在每輪開始時清掉；`useCloudSync` 因此每次登入被拒只請 `AuthProvider` 確認一次，仍被拒時每 5 分鐘再確認一次（之前每 30 秒更新 Token 兩次）。

`cloud_sync_state` 以 `(owner_user_id, master_id)` 為主鍵，儲存 `through_at`、`event_id`、`updated_at`。每批事件與對應進度在同一個 SQLite transaction 提交；若該範圍已讀完，進度移至本輪查詢上限，事件 ID 為空。首次即使尚無資料也會記錄起始範圍。

每輪重新讀取 `device_members`，新獲授權的 Master 首次抓最近 24 小時。已完成的下載範圍從上次進度前 5 分鐘補查，利用事件唯一鍵去重；未完成的範圍用最後提交的微秒 `received_at` 加 `event_id` 精確續傳，避免有限批次一直停在同一頁。增量游標不使用 `phone_received_at`；歷史顯示維持修正後的 `track_at`。

排程在 App 層執行，不依賴雲端頁。每 30 秒觸發，上一輪未完成就略過。斷網失敗下個週期重試；Supabase 回 429 或 5xx 時改為退避（1、2、4 分鐘，之後每 5 分鐘），成功、重試、回到 App 或換帳號時重新從 30 秒開始。每輪自動同步最多執行 120 秒，逾時保留已儲存批次，下輪繼續。登出取消同步並清除該手機的 Session。

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

每輪每台 Master 最多 24 次筆數查詢；沒有補傳時不會下載任何資料。自動核對只涵蓋最近 24 個已結束的整點小時；更早的資料可從歷史畫面的日期列／月曆手動補下載。

## 範圍與限制

- 前景每 30 秒；Android 背景／鎖屏由 WorkManager 每 15 分鐘排程。登入後可以離線查看已下載的快取。
- 離線冷啟動而存取權杖已過期時，SDK 要等連上網路才換得到新權杖（離線時它會先重試約 30 秒才回報沒有 Session）。這段期間 `useCloudSync` 以 `CloudSession.storedSignIn` 讀到仍存著的帳號（只取帳號 ID，不取權杖），地圖照樣顯示那個帳號已下載的狗；登出或 refresh token 被拒時 SDK 會先移除存著的 Session，所以仍然算登出。`AuthProvider` 也一樣：這段期間不清空背景同步（`CloudBackgroundSync`）與 BLE 上傳（`ble_upload_meta`）的 owner，只有真正的 SIGNED_OUT 或什麼都沒存時才清空。
- 雲端頁只提供登入、自動同步狀態及本機資料查閱，不提供手動下載。
- 假設雲端事件為追加且不可變；相同事件重複下載不新增，不更新已下載事件，也不同步刪除。
- 同步中斷／失敗保留已提交批次，下輪依進度補齊。離開雲端頁但仍在 App 前景時，自動同步繼續。
- 登出隱藏本機快取；帳號切換隔離顯示。雲端撤銷 Master 授權不會自動刪除以前合法下載的離線資料。
- 本機表格目前提供常用解析欄位；即時地圖由 `DogMerge` 合併本機 BLE 與登入帳號已下載的雲端資料。

## 首頁的狗 marker

`slave_id` 全隊唯一，所以首頁每隻狗只有一個 marker，取 BLE 與各台 Master 的雲端資料中**最新的一筆**，並標示來源（`BLE` 或 `經 Master N・雲端`）。合併規則在 `src/map/DogMerge.js`，不依賴地圖 SDK。

- 地圖只讀本機 `supabase_dog_status`（`latestBySlave`，每 10 秒一次），不直接查 Supabase；離線仍可顯示已下載的位置。
- 雲端名單只列最近 14 天（`CloudLatest.ROSTER_WINDOW_MS`，以伺服器的 `received_at` 判斷）有資料的狗：下載最新位置時，找狗的那一步多一個 `received_at >= cutoff − 14 天` 條件；名單上的狗照樣拿最後一筆有效定位，不管多久以前（沒有 GPS 好幾天的項圈仍留在最後位置）。以前名單是這些 Master 下存過的每一個 `slave_id`，只會變多，每隻都要每 30 秒 2–5 個請求外加停住脈絡。更久沒消息的狗留在本機 archive，歷史的「＋ 加入」在牠有資料的日子仍列出來（`HistoryDatabase.historyDogs`、`useOlderHistoryDogs`）。
- `mergeDogMarkers` 不再照編號只留前 20 隻（`MAX_DOGS`）：超過 20 隻時用 `keepDogs` 排序，這支手機收到的狗、24 小時內有消息的狗一律保留，只有剩下的名額給其他狗（最近有消息的先）。輸出仍依編號排序。
- 每隻狗分別比較有效定位時間，雲端優先使用修正後的 `track_at`，否則使用 `received_at`；有效的 cloud-only 狗也加入集合，不受其他狗的 BLE 新鮮度限制。來源與新鮮度逐隻判斷。
- 同一定位時間的兩筆保留 BLE；雲端比較時間優先採用修正後的 `track_at`。
- `mergeDogMarkers` 預設 `maxAgeMs = Infinity`，超過 24 小時的最後有效位置仍保留。即時 marker 由 `DogFreshness` 判斷灰化：一般看最後有效定位，室內停住看最後封包，超過 10 分鐘標為未更新；BLE 使用目前時間（另套用手動中斷／重連規則），雲端使用最近成功即時下載的時間，尚未成功、連續失敗超過 10 分鐘，或最近成功的下載超過 10 分鐘（回到前景前在背景很久）且已連續失敗超過 1 分鐘，才改用目前時間（`cloudClock`）。即時路線的選定時間窗只裁切路線；`DogMerge.windowMs` 判斷通訊狀態（畫面傳入 3 分鐘），不等於 marker 的保留期限。從未有有效位置且沒有停住座標的狗不繪製 marker。
- 未登入不讀雲端資料。
- 雲端的狗整批換：最新位置正在寫入（`snapshotPending`，只有發布到讀回那一下）、已提交但地圖還沒讀到、或回到 App 還在「正在更新」時，地圖保留上一批已接受的雲端位置與雲端封包（`src/map/AtomicDogSnapshot.js`）。這支手機接收器的資料不保留：BLE 封包、停住、接收範圍、電量判斷和接收器那隻狗的位置都照常即時更新，卡片也照讀本機的列（`AtomicDogCardReader.js`）。之前整組狗連 BLE 一起保留，而且從每輪開始（等登入最多 65 秒、HTTP 最多 120 秒）就保留，網路慢或不通時這支手機自己的狗、卡片和提醒大部分時間都停住不動。

BLE 是這支手機的時鐘；Wi-Fi 上傳的 `received_at` 是伺服器的時鐘；手機轉送的 `phone_received_at` 是上傳那支手機的時鐘。三個時鐘不一定一致（`src/cloud/ServerClock.js`，2026-10-15）：

- 每個 Supabase 回應的 HTTP `Date` 標頭都拿來估伺服器和這支手機的時差（`CloudClient` 的 fetch 包一層，取最近 7 筆的中位數；來回超過 10 秒的不算）。差在 1 分鐘內當作 0，超過才以 5 秒為單位套用，估計值小幅跳動時不會改動列的時間。
- 即時下載的截止時間在伺服器端換成伺服器時鐘（`downloadCloudLatest` 的 `serverCutoff`），手機時鐘慢時不會漏掉最新的 Wi-Fi 列。快照本身記的 `cutoff` 仍是手機時鐘。
- 下載的列在和 BLE 列碰面前先換成這支手機的時鐘（`cloudRowOnPhoneClock`）。地圖合併前（`MapScreen`）和室內停住、接收範圍判定前（`useCloudDogs`）都會換。Wi-Fi 列扣掉時差；轉送列保留上傳手機的時間，但如果它比伺服器收到的時間還晚 2 分鐘以上，就不相信，改用伺服器收到的時間。這支手機自己的上傳回來時時間不變，HoldStore 的同列去重照舊。
- `DogFreshness`：位置（或封包）時間比判斷用的時鐘還晚 3 分鐘以上時（上面兩個容許值相加），不相信這個時間，直接算「沒有新位置」（`suspect`），不會因為時鐘快了就一直顯示成新的。
- 歷史與儲存的 `track_at` 沒有改，仍是上傳手機的時間。

## 最新位置先發布，完整歷史另外發布（`CloudSync.js`）

每輪自動同步分成三個獨立階段，各自有版本：

1. **最新位置**：先取每隻可讀取的狗的最新封包與最後有效定位，提交成 latest snapshot（`snapshotRevision`），地圖立刻可用。
2. **停住脈絡**：再補完整的室內停住脈絡，成功時同一個 snapshot 版本再前進一次；失敗或逾時只保留已接受的最新位置，不把不完整的脈絡交給停住判斷，也不用空集合蓋掉先前的脈絡。
3. **完整歷史（archive）**：分頁下載先寫入 staging，每頁與 `event_id` 游標同一個交易提交；只有整輪完成才一次發布 staged 資料與完整性證明（`archiveRevision`）。失敗、取消或換帳號都不改已接受的 snapshot，也不發布半套歷史；重建資料庫連線或排程後從保存的游標續傳。發布仍是一個交易（讀的人看到全部或沒有），staged 資料依 id 範圍每 1,000 筆一段搬進去；staged 的副本不再在這個交易裡刪，而是提交後（job 列已在交易裡刪掉，沒有人再讀它）每 1,000 筆一個交易清掉，BLE 和手機路線的寫入可以排在中間（稽核 A F3；刪除約占原本交易時間的三分之一）。清到一半程序結束時，下次 `beginDownload` 先清掉沒有 job 的 staged 列。代價是發布期間檔案多佔一份 staged 資料的空間，之後的 staging 會重用。活動頁的「完整歷史」閘門在 archive 發布前保持關閉。

即時地圖每 10 秒讀一次 latest snapshot（`useCloudDogs`）。每隻狗的停住脈絡帶一個 `context_version`，只有脈絡變了才換。讀的人帶上自己已經有的版本（`knownContexts`），就只會讀回並解析變了的脈絡；兩次下載之間的輪詢一筆脈絡都不讀，一隻安靜好幾個小時的狗也不會每次都被重讀。以前每次輪詢都要把每隻狗的脈絡讀出來，而且解析兩次（稽核 F8）。版本是一次性的字串，所以刪除資料或重開 App 之後，也不會剛好撞上舊的值。存進 snapshot 的封包、定位和脈絡都不帶 `raw_payload`（整筆雲端 JSON）：地圖讀回來時本來就會丟掉它，它卻佔脈絡列的一大半。`raw_payload` 仍然存在 archive 的 `supabase_dog_status`，給雲端資料頁看。接收範圍的判定（`saveRangeState`）只在內容改變時才寫。

雲端回應可能少於要求的 1,000 筆，下載必須讀到空頁才算結束：每頁 1,000 筆等於 Supabase 預設的 `max-rows`，沒有餘裕，而且結束點會成為 checkpoint 與完整性證明，所以完整歷史與手動下載不使用短頁停止。會員清單與停住脈絡每頁只要 500 筆，低於 `CloudPaging.js` 的 `CLOUD_SERVER_ROW_CAP`（1,000），回傳少於 500 筆就是最後一頁，不再多送一次空頁請求；整頁 500 筆仍會讀下一頁。手動下載指定日期是另一個交易：完成的狗與日期才有完整證明，不覆蓋地圖的 snapshot，也不帶出另一個未完成的自動下載。

## 發布階段診斷（`logger.js` 的 `cloudSyncDiagnostic`）

Release 版只輸出固定欄位的雲端同步紀錄，用來核對實際發布次序：

| 事件 | 欄位 | 何時 |
| --- | --- | --- |
| `failure` | `attempt`、`phase`、`failureKind`、`status` | 一輪失敗 |
| `recovered` | `attempt`、`elapsedMs` | 失敗後再次成功 |
| `latest-published` | `attempt`、`elapsedMs`、`revision`，另可附固定的各階段耗時 | 最新位置提交並通過目前世代／取消檢查；停住脈絡完成不再送一次 |
| `archive-published` | `attempt`、`elapsedMs`、`revision` | 自動下載的完整歷史發布完成；手動下載、部分 staging、失敗或取消都不送 |
| `context-published` | `attempt`、`elapsedMs`、`dogs` | 停住脈絡下載並寫入 snapshot 完成 |
| `context-failed` | `attempt`、`elapsedMs`、`failureKind`、`dogs`、`completedDogs`、`requests` | 停住脈絡逾時（10 秒預算）或失敗；最新位置與 archive 照常，不改 UI 也不另外重試。換帳號、離開前景或被新一輪最新位置取代的取消不送 |

`latest-published` 的 `mastersMs` 只算成員清單請求本身；前面等 Session（`CloudSession` 的閘，長時間背景後可能等到 65 秒）另記為 `sessionMs`（只有獨立最新位置引擎有，舊引擎沒有這欄）。兩者都包含 JavaScript 執行緒忙碌時回應等著被處理的時間，所以某一階段很慢時，先看是不是 `sessionMs`，再看同時段 JS 執行緒有沒有被其他工作佔住。

`context-*` 的 `elapsedMs` 從停住脈絡階段開始算（不是整輪），逾時約為 10,000；`dogs` 是這輪 snapshot 的狗數，`completedDogs` 是已下載完脈絡的狗數，`requests` 是已送出的脈絡請求數（含逾時當下還沒回應的那一個），三者都是總數。`failureKind` 沿用 `failure` 的列舉（`timeout`／`auth`／`network`／`storage`／`unknown`），`storage` 表示下載完成但寫入 snapshot 失敗。

Logger 只重建這些數值欄位：attempt／revision 是正的安全整數，耗時是有限非負數，狗數與請求數是非負安全整數（`completedDogs` 不得大於 `dogs`）；其他事件名稱、列舉以外的 `failureKind` 與不合法的值，整筆直接丟棄。帳號、Master／Slave 編號、時間戳、URL、座標、payload 與錯誤物件都不會輸出。寫 log 失敗不影響下載結果。換帳號時，舊帳號已開始的原生交易可能仍寫完，但世代檢查讓它不會被記成成功。這些紀錄只看得到發布次序與停住脈絡的請求總數，看不到個別 HTTP 篩選、頁數或後端索引。

## 驗證

```powershell
npm.cmd test -- --runInBand __tests__/Cloud.test.js __tests__/CloudDataScreen.test.js __tests__/CloudSync.test.js __tests__/CloudForeground.test.js __tests__/CloudReconcile.test.js
```

實機驗收：已授權帳號讀取對應 Master 全部 Slave；無授權帳號下載為空；重複同步筆數不增加；斷網後重新讀取本機資料；登出與換帳號不顯示前一帳號資料；確認頁面沒有手動下載、日期或 Master 篩選欄位。

核對驗收：登入後等待首次核對完成（約 10 分鐘內），在雲端資料頁確認筆數不因核對而重複增加；讓 Master 離線後再連線補傳較早的資料，等待下一次核對，確認補傳的資料出現在本機；連續觀察數輪，確認沒有補傳時不會重複下載。

同步驗收：登入後前景每 30 秒；以 `adb shell dumpsys jobscheduler` 檢查 `$PACKAGE/androidx.work.impl.background.systemjob.SystemJobService`（先設 `PACKAGE=${PACKAGE:-com.antgo.dogtracker}`，若 debug 設有 applicationIdSuffix 也須包含） 的週期與網路條件。切到桌面／鎖屏後觀察工作結束（Logcat tag `CloudHistoryWorker`），本機資料增加且工作之間不持續持有喚醒鎖。斷網工作等待，恢復後續傳；回到前景即讀本機歷史並補下載；登出後排程取消。另驗收程序被系統回收後的冷啟動、帳號切換及長時間 Doze。Android 原生變更需要重新建置安裝 APK。

驗證拒絕讀取時，要另外使用沒有任何 Master 授權的測試帳號。不能以 postgres 或 Secret Key 測試使用者 RLS。

「雲端資料」頁的列表可以點任一列展開該筆的**原始雲端 JSON**（下載時就存在 `raw_payload`）。欄位表只有 App 讀得到的欄位，原始紀錄才看得出 payload 還帶了什麼——例如 Master 自己的座標（硬體問題 H2）。

## 固定位置（後端保留，App 不再使用）

App 不再把狗畫到手動設定的固定位置，也沒有設定表單；室內防飄改由 [室內停留](../placement/README.md) 自動處理。後端的 `slave_fixed_locations` 資料表、`unlock-fixed-location` Edge Function 與兩個 migration 仍保留在 repo 和 Supabase，沒有刪除資料；確認新做法後再另行移除。`__tests__/FixedLocationUnlockBackend.test.js` 仍驗證這個函式。

線上驗收須以一般使用者 JWT 驗證直接寫入被拒絕，以及 RPC 拒絕錯誤／過期／已用憑證、其他帳號或犬隻、撤銷 Master 授權。Jest 驗證畫面和實際 Edge handler 的 mock 行為，不能取代 PostgreSQL migration 與線上整合驗收。

歷史發布保留兩種版本。`publishedRevision`／`publishedPending` 是原有的實體交易閘：任何發布都改變版本，讀到一半跨交易的結果仍丟棄。`dataRevision` 則只決定歷史頁的 rows／IndoorHold 快取要不要重播；完整性證明、archive cutoff、帳號與 generation 的驗證不使用它取代交易閘。

`HistoryMaterialPublication` 在共享 connection lock 內，將每個已發布 `supabase_dog_status` 的 INSERT／UPDATE／DELETE 後接 `changes()`，與版本更新一起放入原 native SQLite TX。重複 INSERT、只有 checkpoint／complete-empty proof 的發布不增資料版本；新增、時間修復及 retention 刪除會增。staging 寫入不追蹤，升級時的 migration／直接 legacy 寫入仍追蹤。SQLite 對相同值的 UPDATE 也可能計數，因此這種情況保守重讀，不宣稱所有 no-op 都會略過。這不是以筆數或內容 hash 猜相同。

此 helper 的 SQL 識別只支援目前 audited writers 使用的普通未加引號 table DML；未來新增 CTE、替換語法、trigger 或另一個已發布表的 writer，必須同步擴充 material tracking 與真 SQLite 守護。未知／失敗的 readback 回到原 physical-revision 重讀；readback 若在 commit 後失敗也會讓 hold cursors 失效。單一 chunk 升級有四個 singleton setup／finish 指令，加 INSERT／UPDATE／eviction 三個 latch，staging 每筆不增加追蹤指令。

`historyPublication()` 另帶 `lineage`：換帳號、刪除全部狗資料與 dispose 才會改變，前景切換（`setForeground`）只改 `generation`。開著今天狗歷史回到前景時，新 generation 的讀取閘要等第一次地圖 ACK 才開；同一 owner／scope／lineage 的已驗證畫面在這段時間繼續顯示（截至舊 cutoff），直到新 generation 讀到的 proof 撤回、失敗或重建出新模型。沒有 `lineage` 的發布者仍以 generation 變更為準。

這項快取調整不保證歷史頁零重算。today 的 cutoff 延伸、明確 reload、日期／帳號／範圍變更仍會重讀；已有完整模型且 material／cutoff／owner／scope／generation 完全相同時，純 physical proof 刷新保留已驗模型；proof 查詢仍重新執行並由原發布閘驗證，失敗或新 proof 不完整就遮蔽。未知 material 或新的資料／範圍仍可能短暫不可用，完成後重建模型。原生多狗慢窗口是否改善需要另做同情境量測，source 守護不能代替 Android 驗證。
