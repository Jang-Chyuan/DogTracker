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
| `HistoryText.js` | 清單與摘要的文字（文案表 c120–c344）：時長、距離、膠囊、移動段、H8 |

時間一律為 UTC 毫秒；公尺為 `distanceM`，持續時間為 `durationMs`。`subject` 為 `dog` 或 `phone`；`source` 為 `all`、`local`（接受 `ble` 別名）或 `cloud`。

共同列使用 `{time, latitude, longitude, source, slave_id, packetTime, locationTime, accuracy}`；`time`／`packetTime` 是封包時間，`locationTime` 是 GPS 定位時間。省略時間欄位時以 `time` 作為既有資料相容備援；明確的 `null` 定位時間不會變成封包時間。原始資料庫欄位會保留，CSV 可讀 `packets` 的原始座標。

`historyTimeline` 的主要選項：

- `dayStart`, `dayEnd`：手機目前時區的一天 `[start, end)`。呼叫端提供 UTC 界線，因此夏令時間的 23／25 小時日也能正確裁切。
- `today`, `now`：是否為今天與現在時間。過去日期按事後規則重算；不使用函式內的系統時鐘。
- `manualRange: {start, end?}`：省略 `end` 代表跟著最新資料。`range` 可直接指定已選好的實測範圍。
- `following`：終點是否延伸；預設為今天且沒有固定手動終點。記錄關閉時傳 `false`。
- `state`：上次結果的 `state`，用於保留已標停留。`timezone` 是識別的一部分；來源、開始、固定結束、時區、既有資料或相關車段改變時會重新計算。
- `replayHolds`：可替換停住重播；預設狗使用既有 IndoorHold 純邏輯，手機不使用。`holdOptions` 可傳 `seed`、`config`、`classify`。

讀取完整當天資料，並為跨午夜提供前一天的必要實測／停住脈絡（停住最多 24 小時）；可提供隔天第一筆以辨識「接續隔天」。不虛構 00:00 定位。`packets` 為篩選去重後原始列，`points` 為選定範圍的顯示／實測流；月曆使用共同來源的封包有無資料，清單與距離使用同一份整理結果，匯出保留原始座標。

`nodes` 是排序後完整清單；`locations` 只有地點列，`sections` 只有交通／缺口列。型別：`departure`、`stop`、`switch`、`indoor`、`movement`、`gap`、`end`。交通方式：`walking`、`moving`、`driving`、`ride`、`gap`。停留與切換點共用 `number`；室內節點不編號。切換點沒有上下車文字與停留時間。節點座標可供後續非同步查地址。

缺口列保留前後實測時間與座標，但 `distanceM`／`countedDistanceM` 都是零；車段保留實際 `distanceM`，`countedDistanceM` 為零。合併停留保留 `interruptionMs`，供清單／PNG／GPX 顯示「不含中斷 N 分」。跨日節點使用 `continuesPreviousDay`／`continuesNextDay`；終點 `label` 為「現在」、「最後」或「結束」。

## 第二次審查（054a，Claude）補上的規則

- 距離改成判定表「距離怎麼加」：每段連續步行的第一筆只當比較點，之後和上一個「有算進去」的點比（不是和前一筆比），所以慢慢走不會被一筆一筆濾掉；缺誤差值當 10 m，下限 5 m。
- 停留的座標改成判定表「停留的代表位置」：造訪裡誤差 25 m 內實測點的平均；判斷圈內圈外仍用第一個實測點（`center`）。
- 判定表「恢復記錄節點」：缺口超過 30 分鐘時，「沒有資料」段之後在中斷後第一筆加 `resume` 節點（不編號；那一點已經是停留或室內節點時不另外加）。
- 停留前後緊貼的切換點：停留結束後幾秒才上車時，中間那段 0 km 的步行和切換點拿掉，停留本身就是分界（H1：停留 2 → 坐車 → 3）。兩個地點之間不到 1 分鐘、0 km 的步行段也拿掉（判定表「停在原處節點的前後」）。
- 停留裡的移動距離算進抵達那段步行（判定表「距離怎麼算」：和有沒有被標成停留無關），清單各段加起來等於摘要。
- 記錄關閉：`closedAt` 給了才寫「記錄已關閉 10:20」；手機沒有存關閉時間，055a 的摘要下一行「記錄已在 10:20 關閉」用最後一筆的時刻。
- 出發偵測的取點改成二分搜尋，一整天 8640 筆在原地也只要幾十毫秒（「今天 x km」每 15 秒重算）。

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
