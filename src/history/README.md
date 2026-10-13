# 歷史純邏輯 API

不讀資料庫、不取得定位、不查地址、不依賴 React／React Native。每次呼叫只傳**一隻狗或手機**的資料；呼叫端負責對象隔離與資料取得。

`index.js` 匯出：

| API | 用途 |
| --- | --- |
| `HISTORY_CONFIG`, `configFor(subject)` | 狗／手機分開的設計門檻 |
| `distanceMeters(a, b)` | 球面直線距離，公尺 |
| `normalizeHistoryRows(rows, source?)` | 資料庫欄位轉為共同格式，不修改原始列 |
| `historySourceStream(rows, {source, replayHolds})` | 先篩來源、封包去重、重算停住、GPS 去重；回傳 `packets`／`points` |
| `filterHistoryPoints(points, {subject, config})` | 實測點、精度與跳點過濾；狗高速點暫存／補回 |
| `replayHistoryHolds(packets, {since, ...holdOptions})` | 共用 `IndoorHold.applyHistoryHolds`，最多往前 24 小時；模型／seed 可透過 `holdOptions` 提供 |
| `historyMovement(points, {subject, config})` | `edges`、`vehicles`、`switches`、計入距離；輸入為過濾後點 |
| `historyVisits(points, options)` | 造訪起訖、圈內點、扣除缺口的時間；輸入為過濾後點 |
| `historyStops(points, options)` | 路線／整天中位數、明顯停留、追加狀態 |
| `historyIndoorNodes(points, options)` | 室內小房子節點；使用重算後封包，不用 GPS 去重結果判斷封包缺口 |
| `historyDeparture(points, options)` | 確認狀態、自動範圍與手動範圍；輸入完整當天過濾後點，可提供完整交通分類 |
| `historyTimeline(rows, options)` | 整合入口：共同資料流、範圍、地點列、交通／缺口列、編號、距離與追加狀態 |
| `countDistances(edges, config)` | 判定表「距離怎麼加」：和「上一個有算進去的點」比，超過兩筆誤差較大者（至少 5 m，缺誤差值當 10 m）才算 |
| `dogHistoryRow(row, source)`, `phoneHistoryRow(row)`（`HistoryRows.js`） | `dog_status`／`supabase_dog_status`／`myLocationTracker` 的列轉成共同格式：封包時間＝手機收到的時間（雲端用 `track_at`），定位時間＝項圈的 `gps_time` |
| `HistoryText.js` | 清單與摘要的文字（文案表 c120–c344、c1276）：時長、距離（`km` 總數；列與游標用 `utils/distanceText`）、膠囊、移動段、H8 |

時間一律為 UTC 毫秒；公尺為 `distanceM`，持續時間為 `durationMs`。`subject` 為 `dog` 或 `phone`；`source` 為 `all`、`local`（接受 `ble` 別名）或 `cloud`。

共同列使用 `{time, latitude, longitude, source, slave_id, packetTime, locationTime, accuracy}`；`time`／`packetTime` 是封包時間，`locationTime` 是 GPS 定位時間。省略時間欄位時以 `time` 作為既有資料相容備援；明確的 `null` 定位時間不會變成封包時間。原始資料庫欄位會保留，CSV 可讀 `packets` 的原始座標。

`historyTimeline` 的主要選項：

- `dayStart`, `dayEnd`：手機目前時區的一天 `[start, end)`。呼叫端提供 UTC 界線，因此夏令時間的 23／25 小時日也能正確裁切。
- `today`, `now`：是否為今天與現在時間。過去日期按事後規則重算；不使用函式內的系統時鐘。
- `manualRange: {start, end?}`：省略 `end` 代表跟著最新資料。`range` 可直接指定已選好的實測範圍。
- `following`：終點是否延伸；預設為今天且沒有固定手動終點。記錄關閉時傳 `false`。
- `state`：上次結果的 `state`，用於保留已標停留。`timezone` 是識別的一部分；來源、開始、固定結束、時區、既有資料或相關車段改變時會重新計算。
- `replayHolds`：可替換停住重播；預設狗使用既有 IndoorHold 純邏輯，手機不使用。`holdOptions` 可傳 `seed`、`config`、`classify`。

讀取完整當天資料，並為跨午夜提供前一天的必要實測／停住脈絡（停住最多 24 小時）；可提供隔天第一筆以辨識跨午夜（`continuesNextDay`）。不虛構 00:00 定位。`packets` 為篩選去重後原始列，`points` 為選定範圍的顯示／實測流；月曆使用共同來源的封包有無資料，清單與距離使用同一份整理結果，匯出保留原始座標。

`nodes` 是排序後完整清單；`locations` 只有地點列，`sections` 只有交通／缺口列。型別：`departure`、`stop`、`switch`、`indoor`、`movement`、`gap`、`end`。交通方式：`walking`、`moving`、`driving`、`ride`、`gap`。停留與切換點共用 `number`；室內節點不編號。切換點沒有上下車文字與停留時間。節點座標可供後續非同步查地址。

缺口列保留前後實測時間與座標，但 `distanceM`／`countedDistanceM` 都是零；車段保留實際 `distanceM`，`countedDistanceM` 為零。合併停留保留 `interruptionMs`，供清單／PNG／GPX 顯示「不含中斷 N 分」。跨日節點使用 `continuesPreviousDay`／`continuesNextDay`；終點 `label` 為「現在」、「最後」或「結束」。

## 分鐘一定有列（2026-10-13）

選取範圍內，清單（`timelinePresentation`）有長度的列首尾相接：沒有空洞、沒有重疊；每列分鐘加上「不含中斷」等於它的起訖時鐘跨度。取代 #115「合併的走路不計中間未觀測時間」。

- 合併的走路：分鐘＝起訖跨度，距離仍是各段之和。
- 手機的缺口列（`沒有資料`，或 `reason: 'uncertain'` 的「GPS 訊號弱」）帶 `sameSession: true` 時是同一次記錄裡的中斷：短於 `listGapMs`（`HistoryConfig`，30 分）就不列出，時間直接併入旁邊有長度的列——先找停留（停留、停在原處、帶停留的出發／終點），再找走路，再找其他移動；不加任何註記（`unlocatedMs` 只在資料上記下併入多少，不顯示）。兩邊只有出發／終點這種點時照列出。兩段走路之間只有這種中斷時合為一段走路。
- 停留裡面的中斷（`stop.gaps`）同理：時間軸在兩端定位屬於同一個 session 時標 `sameSession`；短於 `listGapMs` 的算進停留分鐘，`interruptionMs` 減掉，不再顯示「不含中斷」。30 分以上、換 session（`sessionChange`）、或沒有 session 可證明（舊資料、狗）的中斷照樣扣掉並顯示「不含中斷 N 分」。
- `sameSession`：「GPS 訊號弱」單步兩端都有定位，除非兩端 session 明確不同；沒有定位的缺口要兩端是同一個已知 session。帶 `sessionChange: true`（#135）的列一律自成一列。狗的缺口列都有原因（收不到 GPS／沒收到訊號），沒有這兩種列，也沒有 session，所以不受影響。
- 游標：`shownRowAt` 找出那一刻所屬的清單列；併入的中斷裡，游標不說「這段沒資料」，停留裡就說那個停留（`shownStayDurationMs`，和清單同一個分鐘），走路裡就說已走距離。
- 不到 `gapMs`、沒有任何列的幾秒時間，在走路旁邊時歸那段走路。
- 地圖、`model.sections`、`model.edges`、匯出的 gaps 都不變：地圖照畫中斷，GPX 照在中斷處分段。地圖停留的 TalkBack 也用 `shownStayDurationMs`；GPX 停留航點不含併入的缺口（`excludedMs` 照舊）（下面併入的粗精度靜止時間則算進停留，和 #116 的同地中斷合併一樣）。
- 手機精度超過 `stayAccuracyM`（25 m）但在 `accuracyM`（50 m）內、偵測為靜止的點，仍進 `phoneStationaryPresentationStops`：座標取該段第一個 25 m 內的點，沒有就取第一點，並標 `coarse`／`accuracyM`。`mergePhoneSamePlaceStays` 把貼著同地停留（距離 ≤ `radiusM` + 該段最差精度）的 `coarse` 段併入那個停留：保留編號與座標，只延長分鐘；不會因此把兩個編號停留合併。其餘 `coarse` 段是不編號停留。
- 距離、CSV 列與 GPX 軌跡點不變。`__tests__/PhoneMinuteAccounting.test.js` 用虛構資料檢查這個不變量。

## 第二次審查（054a，Claude）補上的規則

- 距離改成判定表「距離怎麼加」：每段連續步行的第一筆只當比較點，之後和上一個「有算進去」的點比（不是和前一筆比），所以慢慢走不會被一筆一筆濾掉；缺誤差值當 10 m，下限 5 m。
- 停留的座標改成判定表「停留的代表位置」：造訪裡誤差 25 m 內實測點的平均；判斷圈內圈外仍用第一個實測點（`center`）。
- 判定表「恢復記錄節點」：缺口超過 30 分鐘時，「沒有資料」段之後在中斷後第一筆加 `resume` 節點（不編號；那一點已經是停留或室內節點時不另外加）。
- 停留前後緊貼的切換點：停留結束後幾秒才上車時，中間那段 0 km 的步行和切換點拿掉，停留本身就是分界（H1：停留 2 → 坐車 → 3）。兩個地點之間不到 1 分鐘、0 km 的步行段也拿掉（判定表「停在原處節點的前後」）。
- 停留裡的移動距離算進抵達那段步行（判定表「距離怎麼算」：和有沒有被標成停留無關），清單各段加起來等於摘要。
- 記錄關閉：`closedAt` 給了才寫「記錄已關閉 10:20」；手機沒有存關閉時間，055a 的摘要下一行「記錄已在 10:20 關閉」用最後一筆的時刻。
- 出發偵測的取點改成二分搜尋，一整天 8640 筆在原地也只要幾十毫秒（「今天 x km」每 15 秒重算）。
- 判定表「出發偵測怎麼找」補上開車離開（2026-10）：原本開車段落的點不當候選、和開車重疊的確認會撤銷，所以「在 A 待著 → 開車到 B → 在 B 走路」的出發被算在 B 的第一段走路。現在：走路的候選通過 3 分鐘門檻、而且定案前就上車（中間沒有中斷或停住），由這段開車定案，出發仍是走路的候選；在這之前沒有走路出發的第一段開車（狗坐車）本身就是出發，出發時間照「候選的前一筆」（前一筆超過 3 分鐘或停住則用開車第一筆）。兩種都要車子真的開走：開車前 8 分鐘內最後一筆（短於 8 分鐘用下車那筆）離起點超過 80 m，原地 GPS 亂跳湊出的「開車」不算。狗和手機同一規則；整天沒離開仍用第一筆。

## 範圍縮進已確認的停留（`HistoryStops.js`）

範圍完全落在整天已確認的長停留裡時（狗和手機同一規則），回傳 `displayStays`：清單不出現「移動 N 分、0 km」，游標顯示範圍內的停留時間，停留不編號；拉回完整範圍後原本的編號停留照舊。狗另外需要有移動邊（`edges`）才能套用，沒有邊就無法排除短走。

這只是顯示：只看整天的判斷，範圍內沒達到確認停留的短停留不會升級；範圍內有計入距離的移動（例如約 20 m 的短走）、開車／坐車、真正的訊號缺口，或離開後再返回，都不套用。CSV／GPX 仍輸出範圍內每一筆原始觀測，快照的 `stays` 不加入這種停留。`__tests__/DogContainedStayRange.test.js` 有反例。

## 已知缺口：狗在車上沒有 GPS（H2c 坐車段借用手機路線）

設計稿判定表「狗在車上沒定位」要求項圈在車上沒有好定位時，沿著這支手機的路線畫坐車段。這要跨資料流（手機 30 秒速度中間值、接收器聽到這隻狗的訊號強度、項圈 1 分鐘以上沒有好定位），計畫（第 2 段「之後（不排號）」）排在坐車實測確認之後才做。目前的行為：那段項圈沒有定位就沒有實測點，清單照「在車上沒定位、歷史裡沒有手機路線」畫成「沒有資料」段，項圈恢復好定位後接上（超過 30 分鐘另加「恢復記錄」）；不會把車速的跳點當成移動距離（超過 15 m/s 的單筆照跳點丟掉）。`__tests__/HistoryReviewRules.test.js` 有一個測試鎖住這個行為。

## 記錄工作階段切換的同地中斷（手機）

`session_id` 是手機每次啟動記錄服務就換的新 UUID（App 更新、程序被殺、使用者關掉再開記錄）。PR #116 的清單規則只把**同一個工作階段**的同地中斷併進停留；換了工作階段的中斷照「沒有資料」顯示。原本正式的停留判斷（`samePlaceGap`）沒有看工作階段，結果短的這種中斷在清單是「沒有資料」，長的卻變成一段沒中斷的停留，默默把關掉記錄的時間算進去。

短期規則：**清單的規則為準——無法證明的時間不算停留。**

- `samePlaceGap(a, b, config)`：手機兩端都有工作階段而且不同時回傳 `false`（`recordingSessionChanged`）。所以 `historyVisits` 在這裡結束造訪（不管多短，只要超過 `gapMs`；連不到 3 分鐘的切換本來就不算中斷），`phoneGapContinuity` 也不會接起來。只有一端有工作階段（舊資料）時照舊；狗沒有工作階段，不受影響。
- 清單：兩段停留各自編號，中間是一列「沒有資料」，起訖剛好是前一段的最後一筆和後一段的第一筆。這種缺口列帶 `sessionChange: true`：它永遠自己一列，不能被併進旁邊的列（例如短缺口註記「含 N 分未定位」的折疊只適用同一工作階段）。
- 距離不變：`historyEdge` 用 `samePlaceGap(..., { acrossSessions: true })`，跨工作階段的同地中斷仍是 `bridged`（不算走路、不切斷距離計算、不影響開車判斷），所以清單、摘要、「今天 x km」（`TodayRouteEngine`）的距離都和修正前一樣。`historyTimeline` 會把不在停留裡的 `bridged` 邊顯示成缺口列。顯示位置（`phoneStayDisplayAnchors`）也只看地點，切開的兩段停留共用一個標記座標。
- 同一工作階段的同地中斷照 #116：併進停留、清單不出現「沒有資料」。
- 匯出：快照的 `gaps` 含這一列，`stays` 是兩段；GPX 本來就在工作階段切換處分段，CSV 是原始列。

`__tests__/PhoneSessionBreakStay.test.js` 鎖住：長／短的切換都是兩段停留＋「沒有資料」、同一工作階段仍是一段、距離不變、狗不受影響。

長期想法：讓原生端明確記下「記錄關閉」的區間（服務停止、使用者關掉、程序被殺後下次啟動補記），歷史只把真正關閉的時間當中斷；工作階段換了但服務其實沒停（例如 App 更新後立即重啟）的同地中斷，就能像同一工作階段一樣算進停留。

## 清單列的文字（2026-10-13）

- 距離：移動段（`sectionText`，畫面與 PNG 清單）和游標標籤（`cursorLabel`）用全 App 共用的 `distanceText`（`src/utils/distanceText.js`，狗卡片的 `formatDistance` 是同一個函式）：不到 100 m 為 5 m 一階（`0 m`、`45 m`），100 m–1 km 為 10 m 一階（`340 m`），1 km 起一位小數的 km（`1.4 km`）；每一階用四捨五入後的值判斷。摘要（`summaryText`／`movementSummary`／範圍摘要）、「今天 x km」與匯出的總距離仍用 `km()`；CSV／GPX 不變。
- 分鐘：移動段顯示的距離不是 `0 m`、顯示分鐘（`displayDurationMs ?? durationMs`）四捨五入為 0 時，時間寫「不到 1 分」（c1276）。只改文字；`durationMs`／`displayDurationMs` 不變。
- 出發（在室內就不要出發了）：室內節點正好從第一筆開始時，`historyTimeline` 本來就不加出發節點（#64）；`timelinePresentation` 另外在第一列是出發、1 分鐘內接著室內節點、中間只有沒計入距離的走路／移動或 `uncertain` 列時，拿掉出發和中間那幾列，清單從室內開始。模型的 `departure` 節點、地圖起點與 CSV／GPX 不變。`__tests__/HistoryRowText.test.js` 用虛構資料檢查這三條。
- 跨午夜的起點：清單第一列是 `continuesPreviousDay` 的停留或室內、而且開始時刻在當地午夜後 3 分鐘（`gapMs`）內時，`timelinePresentation` 把那列的開始拉到 00:00，分鐘也從 00:00 算（「00:01 接續前一天」→「00:00 接續前一天」）；更晚才有第一筆就照第一筆。模型節點不變。
- 跨午夜的終點：`continuesNextDay` 的終點 `nodePill` 回傳 `null`（不寫「接續隔天」，c334 已移除）；併入末停留時只剩停留膠囊「停 N 分」；`continuesNextDay` 的室內節點寫「室內・N 分」。節點欄位不變，`continuesNextDay` 仍保留給其他用途。

## 手機靜止時的粗定位（2026-10-13）

- 手機偵測器鎖定為靜止、精度超過 `stayAccuracyM`（25 m）但在 `accuracyM`（50 m）內的點，在造訪已有 25 m 內的靜止點、離造訪中心不超過 `stillPlaceM`、且之前沒有已判定的離開點時，算進該造訪的時間（不切開、不算中斷），但**不參與**代表位置的平均（只有 25 m 內的點投票；沒有其他點時才用全部）。只有粗定位、沒有 25 m 內靜止點的時段不在這裡變成停留。
- 偵測器判為 `unknown`、但自己量到的可信速度低於 `stillMps` 的點，不是走路：那段邊是 `uncertain`（「GPS 訊號弱」），不會變成 0 km 的走路分鐘。這種邊帶 `stillUnplaced`；同一次記錄裡連續這種邊、原始位置都在起點 `radiusM` + 該點精度內、達 `stayMs` 時，`phoneStationaryPresentationStops` 把它當成 `coarse` 的靜止段：貼著同地停留就併進那個停留，否則是不編號停留。所以清單「不到 30 分的中斷併入旁邊」不會把它併成 0 m 的走路。量到 ≥ `stillMps` 的可信速度仍照走路計算。
- `__tests__/PhoneCoarseStationary.test.js` 用虛構資料鎖住這些行為。
