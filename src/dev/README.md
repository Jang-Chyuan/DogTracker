# 畫面情境（只在 debug 版）

模擬器做不到的狀態（接收器連線中／斷線、雲端資料、狗停在室內、舊位置…）用「畫面情境」打開，再截圖比對設計稿。情境只換掉畫面本來就收的**輸入**，畫的是真的畫面。

```
dogtracker://dev/fixture?name=<名稱>    打開情境
dogtracker://dev/fixture?name=off       回到真實資料
dogtracker://dev/fixture?name=<名稱>&page=<頁>   開在設定的某一頁：settings receiver phone cloud alerts advanced diagnostics wifi liveData cloudData locationRecords permissions pair paired；map（留在地圖，例如看 history-today 的「今天 x km」）、history（歷史頁）
```

- 只有 `__DEV__` 會監聽（`useScreenFixture.js`），只有 `android/app/src/debug/AndroidManifest.xml` 宣告 `dogtracker` scheme；release 版收不到這個連結。
- 情境開著時，真實的 SQLite／BLE／雲端照常在背景跑，只是地圖不讀它們（雲端讀取暫停）；情境不寫入任何資料。

## 情境換掉哪些輸入

| 輸入 | 情境裡寫什麼 | 經過哪段真的程式 |
| --- | --- | --- |
| 接收器狀態 | `BleBackground.getState()` 的回傳值（含 `expectedMasterId`） | `useReceiverState` → `ReceiverState.js`（`receiverLink`、`receiverNumber`、`isOtherReceiver`） |
| 本機 BLE 列 | `dog_status` 的列（含 `satellites`、`hdop`、`usb_present`、`rssi`、`master_lat/lon`） | `mapDogStatusRow`、`mergePositionSamples` → `tracking.point`／`positionSamples` |
| 雲端列 | `supabase_dog_status` 的列 | 模仿 `CloudDatabase.latestBySlave`／`latestStatusRows`（含環境模型）→ `cloudDogs.rows`／`packets` |
| 停在原處、接收範圍 | **給列，不直接給 hold 或判定**：本機＋雲端列照 `holdRows` 冷啟動的方式交給真的 `HoldStore`／`IndoorHold`＋內建環境模型算出 `holds`、`statuses`；同一批列也算出每隻狗的接收範圍判定 `ranges`（`ReceiverRange.js`） | `mergeDogMarkers`、`outOfRangeLines` |
| 上方卡片 | `dismissed`（按過 ✕ 的卡片）、`storageError`（`realWriteError`）、`mapFailure`（`'tiles'` 沒有底圖／`'component'` 地圖打不開，交給 `GoogleTrackingMap` 的 `failure`） | `TopAlerts.js`（`topCards`、`gearReasons`）→ `TopAlertCards`、齒輪紅點 |
| 雲端同步狀態 | `useCloudSync` 的 `ownerId`、`lastSuccess`、`lastDownloadAt`、`failingSince`、`error`、`offline` | 地圖收到的 `cloudSync`；雲端狗的「沒有新位置」照 `DogFreshness` 用 `lastDownloadAt` 判斷；S3 的下載列 |
| 上傳狀態 | `useCloudUpload` 的回答（`upload`：每台接收器的上傳方式、可上傳的接收器、每台還沒上傳的筆數、需處理、最後上傳成功、錯誤；動作不寫入）、`expired`（登入失效）、`dialog`（S3 打開的確認框） | `AccountModel.accountPage` → S3；上傳錯誤 → 齒輪紅點、S1「!」 |
| 手機位置／路線 | 現在位置（`useLiveLocation` 的樣子）和最近 10 分鐘的路線 | 地圖上的手機點；路線交給真的 `RideAlong` 判斷坐車 |
| 手機記錄、權限 | `phone.recording: false` 讓記錄服務沒在跑；`phone.permission`／`phone.services` 是 `usePhoneLocation` 的回答（預設精確位置、定位服務開著） | `todayPill`（右下「今天 x km」的 icon）、`phone.enabled`（地圖藍點） |
| 今天的路線 | `phone.today`：今天 `myLocationTracker` 的列（每 10 秒一筆） | 和 `useTodayRoute` 同一套 `todayRouteDistance`（出發偵測、開車不算，src/history）算出「今天 x km」 |
| 歷史畫面（054a/055a） | `history`：舊歷史頁的查詢（看哪隻狗或我的路線）、狗那一天的 `dog_status`／`supabase_dog_status` 列；我的路線用 `phone.today` | 時間軸清單照 `historyDayRows` 的讀法交出（`HistoryRows` → `historyTimeline`）；地圖的軌跡照 `historyGeometry` 畫；情境開著時歷史頁不讀這支手機的資料 |
| 歷史畫面開成什麼樣子 | `historyView`：`rangeOpen`（範圍條打開）、`manual`（已經拖過的範圍 `{ start, end, following }`）、`calendar`（`'month'` 月曆／`'months'` 選月份打開）、`goTo`（開在別天，只在雲端的日子會開始下載）；情境拖的範圍只記在情境自己的記憶（`fixture:<名稱>:`），不混進真實的範圍 | `useHistoryScreen`（`memoryScope`、`preset`）、`HistoryScreen`（`initialRangeOpen`） |
| 雲端的日子、下載（054b） | `historyCloud`：`fixtureHistoryCloud` 照 `HistoryCloud` 的介面回答（`newestBefore`、`earliest`、`download`），資料是情境自己的「雲端」列；下載把那天的列放進情境的 `supabase_dog_status`；`online: false` 沒網路；`seed` 是開頭就知道的雲端日子 | `useHistoryCloud` → 月曆的點、‹ ›、H3c／H3d；情境從不連 Supabase |
| 狗的名字 | `dogAliases`（4 豆豆、6 小黑、8 阿福） | 名稱牌、卡片、個人頁（A5） |
| 狗的頭像 | `avatars`（訊號源編號 → 頭像；沒給就是預設插圖）；`src/dev/fixturePhoto.js` 是腳本畫的假照片 | 地圖標記、卡片、個人頁 |
| 時鐘 | 固定 `FIXTURE_NOW` = 2026-10-07 09:30（台灣） | 地圖的 `now`（取代 `useMapClock`） |
| 提醒設定 | `alerts`（AlertPreferences，沒給就是預設）、`alertsOpen`（S6「狗」展開）；S6 的開關只改記憶體（`useFixtureEdits`），不寫進這支手機的設定 | `alertsPage`、`alertsHomeStatus` → S6、S1「提醒」 |
| 診斷的資料頁 | `diagnostics`：同一批列照即時資料（`dog_status` 新的在前）、本機／雲端資料（登入的帳號、含原始 JSON）、記錄清單（`phone.today` 當 `myLocationTracker` 的列）的讀法交出；`readFailure` 讓三頁都讀取失敗 | `LiveDataSettings`、`CloudDataScreen`、`LocationTrackerScreen`；S8 的速度緩衝讀同一批 `dog_status` 列 |
| 接收器 Wi-Fi | `wifi`（接收器存的網路，預設「家裡、辦公室」、使用中「家裡」）；新增、刪除只改記憶體 | `useReceiverWifi` → S7 第二行、Wi-Fi 頁 |
| 刪除全部狗資料 | `deletion: { unsent, open }`：還沒上傳的筆數、確認框一打開就出現；情境裡「先上傳」一律沒網路、「一起刪除」不刪任何東西 | `useDeleteDogData` → S7 確認框 |
| 啟動 | `launch`：冷啟動時 `Launch.launchScreen` 讀的輸入（資料庫打開了沒／錯誤、設定讀完沒、引導走到哪一步、恢復登入結束或超過 10 秒、登入了沒、恢復時登入已失效）；`restoring`：恢復登入還在等 Supabase | `launchScreen` → App 開在地圖、D1（第一次／登入失效）或 D0 啟動失敗；S3「暫時連不上，會自動重試」 |
| 打開的卡片 | `openDog`（訊號源編號）；`openPage: 'edit'` 再打開牠的個人頁（A5） | `MapScreen` 開那隻狗的摘要卡片（A3） |
| 初次使用 D2–D4 | `permissionsGuide`（D2 每列的允許狀態 `grants`、問過了沒 `asked`）、`pairing`（D3 的畫面：`view`、`camera`、`dialog`、`target`、`nearby`、`input`）；開在引導的那一頁（有進度條）。情境不問任何權限、不掃描、不連線，掃描框裡不開相機 | `permissionsPage` → D2；`usePairing` → D3；D4 用 `pairedPage` 讀同一批本機列 |
| 地址 | `geocoder`：沒給＝每個地方都查不到；`{ names: [...] }` 照畫面問的順序給假答案（`{ line, awayM }`、`{ district }` 或 `null`）；`{ offline: true }` 沒網路；`'real'` 用這支手機的 Geocoder。情境用自己的 lookup，不寫進手機的地址快取 | `AddressLookup`（`describePlace` 的 50 m／300 m／區規則）→ 卡片「位置」第二行、歷史清單的節點 |
| 卡片的讀數 | 同一批列的 `activity`／`activity_valid`／`battery_valid`，`readCardRows` 照 `CloudDatabase.dogCardRows` 的查法交出 | `DogCardReadings`（活動量每分鐘、最新有效電量）→ `DogCardModel` |

第三版沒有隱藏的狗、跟隨；情境裡卡片的「看軌跡」不會寫進這支手機的歷史查詢。在情境裡的個人頁（A5）改名字、換頭像只記在記憶體（`useFixtureEdits`），畫面照樣更新，換情境或關掉就忘記，不會寫進這支手機的狗名和 `dog_avatars`。所有座標都是桃園車站附近捏造的位置，不要用真實資料的區域。

## 現有情境

| 名稱 | 狀態 |
| --- | --- |
| `all-good` | 接收器 7 收資料中、雲端同步正常、三隻狗都是新的、手機記錄中 |
| `no-data` | A6：沒設定接收器、沒登入、沒有任何狗 → 上方卡片「還沒有狗的資料」＋「連接接收器」「登入 Supabase」 |
| `no-data-signed-in` | 同上但已登入（雲端沒有資料）→ A6 只有「連接接收器」 |
| `signed-out-map` | 沒登入（「稍後再說」）：只有接收器 7 收到的豆豆、狗 5；手機裡之前帳號下載的雲端列（小黑、阿福）不畫 |
| `receiver-connecting` | 接收器 7 剛選好還沒收到資料；最新一筆封包來自之前用的接收器 3，不能當成 7 畫 |
| `receiver-disconnected` | A2：接收器 7 這次連上後、五分鐘前斷線（`disconnectedAt`），自動重連中 → 上方卡片「接收器 7 斷線了」「09:25 斷線・正在自動重連」「接收器設定」；不畫範圍圈 |
| `receiver-disconnected-dismissed` | A2b：同上、卡片按過 ✕ → 沒有卡片，齒輪紅點 |
| `storage-failed` | 位置存不進手機（空間不足）→ 上方卡片「位置存不進手機」「手機空間不足」「檢查空間」 |
| `storage-failed-other` | 位置存不進手機（其他原因）→ 卡片寫原因＋「看原因」 |
| `map-load-failed` | A2c：底圖載入失敗 → 狗、手機、範圍圈畫在沒有底圖的地圖上＋「地圖載入失敗」「重試」 |
| `map-unavailable` | 地圖元件打不開 → 灰底＋「地圖打不開」「狗的位置還是會照常收、照常提醒」「重試」 |
| `cloud-failing` | 雲端下載失敗 6 分鐘 → 只有齒輪紅點 |
| `receiver-battery-low` | 接收器 7 自己的電量 15% → 只有齒輪紅點 |
| `dog-indoor` | 小黑進室內 12 分鐘：先有清楚定位，之後封包沒定位 → 真的 hold 規則判「室內」 |
| `dogs-aged` | 豆豆最新、小黑 4 分鐘前（還算新）、阿福 40 分鐘前（灰色頭像＋紅色「!」＋放大） |
| `range-out` | 豆豆從接收器 7 走到 1.6 公里外：不在接收範圍，從範圍圈邊緣拉紅色虛線 |
| `range-near-edge` | 豆豆在 880 m（快離開，800 m–1 km）：圈內、不畫線，卡片才變琥珀（046） |
| `range-returning` | 豆豆出去 1.3 公里後走回 950 m：還沒解除（要 900 m 內 2 筆、跨 2 分鐘），仍是圈外，但畫在圈內所以不畫線 |
| `range-stale-inside` | 小黑快 3 分鐘沒有新位置，最後一筆時在範圍內（780 m）；之後接收器往反方向走 300 m，那個位置現在落在圈外 → 判定停在最後一筆，不畫線 |
| `dog-low-battery` | 豆豆電量 15%、沒在充電：紅色「!」＋放大；小黑 15% 但在充電：沒有角標 |
| `dogs-indoor-stacked` | 豆豆、小黑、阿福在同一個狗舍停在原處（相距幾公尺）：小房子，名稱牌合成「3 隻・室內」；狗 5 在外面 |
| `dogs-overlap` | 豆豆、小黑、阿福走在一起：名稱牌合成「3 隻」，阿福電量低所以小標有紅點；點「3 隻」跳出重疊小選單 |
| `dog-never-fixed` | 訊號源 9 一直有封包但從沒定位：地圖上不畫 |
| `dog-stale-24h` | 阿福最後位置是 26 小時前：照樣畫在地圖上（灰色＋紅色「!」） |
| `dogs-offscreen` | 只有豆豆在接收器 7、走在手機旁邊（第一個畫面框住牠和手機）；五隻雲端狗在西邊 2–3 公里：左邊一個提示，三個小頭像（阿福 40 分鐘沒有新位置，排第一、紅框）＋「+2」；狗 9 在東邊 2.5 公里：右邊一個提示 |
| `cold-start-far-cloud` | 豆豆、狗 5 在接收器 7、手機旁邊；阿福的最後位置是 26 小時前、約 10 公里外（雲端）：第一個畫面只框本機的狗和手機（阿福用邊緣提示），按「框住全部」才把阿福框進來 |
| `cloud-only` | 沒設定接收器，小黑、阿福只從雲端來：不畫範圍圈、沒有接收範圍判定 |
| `card-ok` | 豆豆的卡片：在範圍內、62%、休息中 已 18 分鐘（沒有「位置」列） |
| `card-near-edge` | A3：豆豆 880 m，「接收範圍」琥珀「快離開接收範圍」 |
| `card-problems` | A3b：豆豆 09:05 之後沒有新位置、15%、不在接收範圍，活動量「—」 |
| `card-indoor` | A7b：小黑停在原處（室內）、充電中 62%、休息中 已 40 分鐘，沒有「接收範圍」列；「位置」第二行「桃園區中正路 1 號附近」 |
| `dog-indoor-no-address` | 同 `card-indoor` 但沒網路：「位置」只寫「室內」、沒有第二行（列高照樣 64dp），不轉圈 |
| `card-indoor-geocoder` | 同 `card-indoor`，地址用這支手機自己的 Geocoder 查（要網路＋Play services） |
| `card-cloud-dog` | 小黑只從雲端來：沒有「接收範圍」列；劇烈活動 |
| `card-phone-no-fix` | 手機最後定位 15 分鐘前：方向距離改寫「手機沒有定位」 |
| `card-readings-old` | 豆豆位置是新的，但電量、活動量 09:11 之後沒有讀數：「62%（09:11）」「休息中 已 12 分鐘（09:11）」 |
| `dog-edit` | `card-ok` 再按鉛筆：豆豆的個人頁（A5）蓋在卡片上 |
| `dog-photo-avatar` | 小黑用照片當頭像（新位置、彩色），地圖和卡片都是照片 |
| `dog-photo-stale` | `dogs-aged` 裡的阿福用照片當頭像：40 分鐘沒有新位置，地圖和卡片上的照片都轉灰階（白框、紅色「!」照原色） |
| `phone-recording` | 和 `all-good` 一樣：記錄中、今天走了 2.7 km → 右下藍色走路小人「今天 2.7 km」（A1） |
| `phone-recording-off` | 09:05 關掉記錄、之前走了 2.7 km → 灰色走路小人、灰字「今天 2.7 km」 |
| `phone-no-permission` | 定位權限被拿掉（之前走了 2.7 km）→ 灰色走路小人加斜線、灰字「今天 2.7 km」（A2）；沒有藍點 |
| `phone-no-route` | 記錄關著、今天沒有任何路線（只有昨天的）→ 灰色「未記錄」 |
| `cloud-signed-out` | S3 沒登入：「未登入」＋「登入 ›」→ D1；D1 的完成、「稍後再說」、返回鍵都回 S3 |
| `cloud-ok` | S3 已登入、最後下載成功、還沒上傳 0 筆、接收器 7 由這支手機上傳 |
| `cloud-failing&page=cloud` | S3 照設計稿：「下載失敗」「連不上 Supabase・09:24 起」「重試 ›」、還沒上傳 12 筆、最後上傳成功 |
| `cloud-upload-pending` | S3：需處理 3 筆（紅色「!」＋「重試 ›」）、還沒上傳 12 筆 |
| `cloud-unreachable-retrying` | S3：開 App 後還沒連上過 Supabase →「暫時連不上，會自動重試」 |
| `cloud-expired` | S3 使用中登入失效：紅色「!」「需要重新登入」＋「登入 ›」→ D1（也寫「需要重新登入」）；齒輪紅點、S1「!」 |
| `upload-switch-confirm` | S3：接收器 7 由 Wi-Fi 上傳、手機裡還有 120 筆，切換確認框打開（c255） |
| `upload-switch-offline` | 同上但沒網路：確認框寫「要先上傳完 120 筆，請連上網路」、不能切（c256） |
| `alerts-default` | S6 提醒：全部開、震動開、聲音關、通知已允許；S1「提醒」寫「震動」 |
| `alerts-some-off` | S6：不在接收範圍、接收器電量低關掉，聲音開；「狗」展開三個開關（部分開）；S1 寫「震動、聲音」「部分開」 |
| `diagnostics-ok` | S8：豆豆（接收器 7，速度緩衝「移動中」）、小黑、阿福（雲端）各自的環境模型結果；三個資料頁有資料 |
| `diagnostics-empty` | S8：沒接收器、沒登入、沒有狗、沒有手機記錄 → 「還沒有狗的資料」，三個資料頁都是空的樣子 |
| `diagnostics-error` | S8：位置存不進手機（其他原因）→ 最上面寫原因（「看原因」的去處） |
| `diagnostics-read-failed` | 手機裡的資料讀不到 → 三個資料頁「讀取失敗」＋「重試」 |
| `advanced-delete-confirm` | S7：按了「刪除全部狗資料」、還有 120 筆沒上傳 →「還有 120 筆沒上傳：先上傳／一起刪除」（c296）；「先上傳」→ 沒網路的說明 |
| `notifications-denied` | S6「通知權限 未允許 開系統設定 ›」；S1「提醒」「手機」只放紅色「!」；地圖齒輪紅點 |
| `onboarding-first-launch` | 第一次開 App、沒登入 → D1「登入 Supabase 帳號」，上方引導進度條第 1 步（共 4 步）、下方「登入」「稍後再說」；情境裡的「稍後再說」不寫進這支手機的設定 |
| `auth-restore-slow` | 恢復登入超過 10 秒還連不上 Supabase → 先用手機裡的資料進地圖（只有接收器 7 的豆豆、狗 5）；`&page=cloud` 的 S3 寫「暫時連不上，會自動重試」 |
| `auth-expired` | 冷啟動時恢復登入發現登入已失效 → D1 上方紅字「需要重新登入」（沒有進度條）；完成、「稍後再說」、返回鍵都回地圖 |
| `onboard-permissions-partial` | D2c：附近的裝置已允許、精確位置只給了大概、通知未允許 → 紅色「!」＋「開系統設定 ›」，按鈕「下一步」 |
| `onboard-permissions-done` | D2d：三列都「已允許」、按鈕「下一步」 |
| `pair-wrong-qr` | D3b：掃到不是接收器的 QR →「這不是接收器的 QR Code」「手動輸入」「再掃一次」 |
| `pair-camera-denied` | D3a 相機被拒：掃描框換成「需要相機才能掃描」「開系統設定 ›」，下面照樣有「手動輸入」 |
| `pair-manual-nearby` | D3c：輸入「DogGPS-Master 7」，搜尋中，附近找到 DogGPS-Master7（訊號強）、DogGPS-Master3（訊號弱） |
| `pair-connecting` | D3d：「正在連 DogGPS-Master7…」＋「取消」 |
| `pair-failed` | D3d 30 秒連不上：「連不上接收器 7」「手動輸入」「重試」 |
| `pair-mismatch` | QR 寫 7、收到 3：「這不是要連的接收器」「要連 7，收到的是 3，已中斷連線」「稍後再說」「重新掃描」 |
| `pair-done-sources` | D4：已連上接收器 7、收到訊號源 4、7、9（9 還沒定位也列出） |
| `pair-done-empty` | D4b：已連上接收器 7、還沒收到訊號源 |
| `history-my-route` | 歷史畫面（055a）、我的路線（H1）：約 07:02 出發、兩個停留、開車 6 分（切換點 3）、停留、走到現在；地址是捏造的（一個查不到） |
| `history-dog` | 歷史畫面、小黑（看軌跡，H1 狗的歷史）：兩個停留、坐車 3 分、停留、移動到現在 |
| `history-range-open` | H2b：同 `history-my-route`，範圍條打開、開始已拖到 07:50（「出發（手動）」），結束跟著現在（`historyView`） |
| `history-single-point` | 只有一筆：豆豆今天只有 09:10 一筆 → 一個點、距離 0、沒有「調整範圍」 |
| `history-empty-day` | H8：我的路線今天沒有紀錄（昨天有）→「今天還沒有路線」、右上匯出變淡、‹ 跳到昨天 |
| `history-today` | 歷史頁、我的路線（H1/H2）：06:50 在家、約 07:05 出發、兩個停留、走到現在；出發、停留 1、現在有地址（停留 1 是「約 120 m」），停留 2 查不到（座標＋「查不到地址」）；`&page=map` 看右下「今天 x km」＝摘要的距離 |
| `history-no-departure` | 我的路線：06:30 起一直在家附近 →「還沒出發」，範圍＝今天全部記錄，沒有停留 |
| `history-mode-switch` | 我的路線：走路 → 開車 12 分 → 走路，換方式的地方各一個編號點（交通方式切換點），最後停留 |
| `history-gap` | 豆豆：中斷 12 分（「沒有資料」）和 40 分（「沒有資料」＋「恢復記錄」） |
| `history-indoor` | 豆豆：走路、停留，進室內 25 分（小房子節點「室內・N 分」，不編號、不算距離），再走路 |
| `history-calendar` | H3b：小黑的月曆（10 月）。手機裡有 9/29、9/30、10/2、今天；雲端另有 8/12（最早）、8/20、9/5、9/28、10/3。點 9/28 或 10/3（只在雲端）→ H3c 下載 3.5 秒後出現那天 |
| `history-calendar-querying` | 月曆上方「查詢中…」：雲端一直沒回答；還沒查明的日子照一般字色、不能點 |
| `history-calendar-failed` | 「雲端的紀錄查不到　重試」：還沒查明的日子照一般字色、可以點（點了下載） |
| `history-month-picker` | H3e：選月份（8、9、10 月有紀錄，1–7 月灰、11–12 月還沒到） |
| `history-cloud-offline` | H3d：沒有網路；點 9/28 → 月曆不收、日期不變，下方「沒有網路，9/28 的紀錄還沒下載，連上網路再試」 |
| `history-calendar-signed-out` | 沒登入：只有手機裡的日子有點，不查雲端 |
| `history-cloud-downloading` | H3c：開在 9/28 下載中（不會結束；取消或返回鍵 →「這天的紀錄還沒下載完　重試」） |
| `history-cloud-failed` | 9/28 下載失敗、手機裡沒有：「這天的紀錄還沒下載完」＋「重試」（不是 H8） |
| `history-cloud-incomplete` | 9/28 下載到一半失敗：那一半的路線＋「資料不完整　重試」 |
| `db-open-failed` | 手機裡的資料庫打不開 → D0 啟動失敗「手機裡的資料打不開」＋「重試」「診斷」；「診斷」最上面寫原因 |

## 新增情境（之後每個 PR）

1. 在 `ScreenFixtures.js` 的 `FIXTURES` 加一個 `'名稱': now => ({ receiver, cloud, phone, ble, cloudRows })`。用檔案裡的 `bleRow`／`cloudRow`／`series`／`at` 產生列，時間一律寫成 `now - …`。
2. 畫面需要新的輸入時：先讓畫面從 props 收這個輸入，再在 `buildFixture` 產生、在 `applyScreenFixture`（App 交給地圖的輸入）或 `MapScreen` 的 `fixture` 參數換掉。不要在畫面裡判斷「是不是情境」。
3. 在 `__tests__/ScreenFixtures.test.js` 加一個測試，用畫面同一套函式檢查這個情境真的產生名字說的狀態。
4. 截圖並和設計稿同一段並排放進 PR。

## 截圖

```bash
npm start                                  # Metro（另一個終端機或背景）
adb reverse tcp:8081 tcp:8081
cd android && ./gradlew -q installDebug && cd ..
# 打開 App、停在即時地圖，等冷啟動完成
scripts/fixture-screenshots.sh <輸出資料夾> [名稱 …]   # 不給名稱就全部
```

腳本會把狀態列時鐘設成 09:30（Android demo mode），每個情境等 App 記錄 `[ScreenFixture] showing <名稱>` 後再等 `FIXTURE_WAIT`（預設 8）秒讓地圖移動和載入圖磚，最後切回 `off` 並關掉 demo mode。只想手動看一個：

```bash
adb shell am start -a android.intent.action.VIEW -d 'dogtracker://dev/fixture?name=dog-indoor' com.dogtracker
```
