# 歷史地圖

## 第三版歷史畫面（055a：一隻狗或我的路線）

狗卡片「看軌跡」或右下「今天 x km」打開（`App` 的 `history` 頁，`route.target`）。畫面在同一張地圖上：

- 上方固定列（`HistoryScreen`）：「‹ 回到現在」、單一狗膠囊（主角 26dp 頭像＋2dp 路線色圈＋名字；其他狗最多兩個 18dp 頭像、重疊 6dp，多出以 +N 表示）、spacer、可選警告數及匯出 icon。列不捲動。「我的路線」膠囊不可點。
- 下方面板（`HistoryPanel`）固定使用即時狗卡片的 75% 高度上限（扣狀態列），不再有高度切換；日期、摘要與清單一起捲動，大字體也能看完最後節點。底部保留安全區與 16dp 內距。
- 日期列「‹ 10/03（六）今天 ▾ ›」：‹ › 跳到前一個／後一個有紀錄的日子（`HistoryDatabase.historyDays`，本機＋帳號下載過的雲端列；只在雲端的日子、月曆與 ▾ 是 054b）。
- 摘要「08:03 – 現在 ▾」＋距離時間；「調整範圍」打開範圍條（`HistoryRangeSummary`），拖兩端的圓點改開始、結束，對到那天的實測點，不到 1 分鐘彈回；改過的範圍這一天記住（`RangeMemory`，App 開著時）。
- 時間軸清單（`HistoryTimelineList`）：點節點游標跳過去、那一列淡色底、地圖移過去（220 ms）、震兩下；點「沒有資料」游標停在缺口前最後一筆（灰色虛線外圈、「這段沒資料（最後 10:29）」）。
- 地圖（`HistoryMapModel` → `GoogleTrackingMap`）：範圍裡的路線（游標之後 3dp 30%、開車／坐車 2dp 實線、中斷不連線）、範圍外 2dp 虛線 routeFaded、停留／切換點編號、停在原處的小房子、時間標記、游標點＋兩行標籤；拖游標（`HistoryCursor`）、點路線（24dp 內）換游標時刻；點空白處收起範圍條。
- 返回鍵：範圍條 → 面板 75% 回一半 → 離開歷史。
- 震動（`src/utils/haptics.js`，Android 的 haptic feedback）：每 10 分 tick、整點 click、進停留／點節點 double、拖到頭 heavy、放開範圍 tick、換日期 tick。

## 多隻狗（H7）

- 點狗膠囊打開「看哪幾隻狗」（`HistoryPickers.DogsSheet`）：一起看的狗可換主角及移除（主角無 ✕）；加入區按訊號源編號排，這天沒有紀錄的狗 40% 並可加入；滿 4 隻加入區變淡且寫「最多同時 4 隻」。選了立即生效、小視窗維持開啟，點空白處或返回鍵關閉。只有一狗且可加其他狗時尾端 ＋；沒有其他狗時不可點；多狗尾端 ▾。色槽跟著狗、移除後再加入用最小空色槽。
- 主角（`HistoryMultiModel.multiDayModel`）：面板、清單、停留編號、時間標記、相機跟著牠；那天沒紀錄的狗不當主角；點小視窗的狗或地圖上的頭像換主角，範圍與游標時刻不變，地圖移到新主角的游標點、清單捲到游標附近的節點。
- 共同範圍：打開或換日期時主角的自動範圍（之後換主角、加入、移除都不改）；拖範圍對到所有狗合起來的實測點；範圍記在入口那隻（還在畫面上時）。
- 共用游標：主角是頭像 40dp＋路線色光暈＋名稱牌，標籤在上方；其他狗 32dp 頭像（路線色底）＋名稱牌，沒資料時停在缺口前最後一筆、灰色虛線外圈；其他狗的路線 3dp、游標前 50%、後 20%。
- 歷史永遠合併本機與雲端，沒有來源選擇器；同一 slave_id＋定位時間只算一次，本機優先保留接收器距離。封包來源標記仍保留供診斷及去重。月曆、下載、H7 及匯出均使用合併資料。

舊的「歷史軌跡」查詢卡片（`HistorySheet`）、回放（`HistoryPlayback*`）、多天範圍與舊的三角游標都拿掉了；`useMapHistory` 只剩偏好（狗名）、聽過每隻狗的接收器和日子讀取（舊匯出的每 10 秒查詢在 056 拿掉）；舊卡片的日期清單與雲端日子掃描（`CloudDays`）、草稿預覽、`HistoryCoverage`（「本機最早只到…」）、`listDays`、`hasPhoneTrack` 在 055b 拿掉（日期列、月曆、雲端下載與「資料不完整」取代）。

## 共用的資料

即時資料的狗（`dog_status`）以 Master／Slave 分別使用最近 3 個原始點平滑（`SmoothCloudHistory`）；速度超過 10 km/h 時最新點占 90%。無效座標、超過 2 分鐘中斷或跨日期變更線重置平滑，Master 切換處斷線。結果另存於 `dog_status` 的 `display_latitude`、`display_longitude`、`display_version`（目前為 1）；`slave_lat`／`slave_lon` 不變。雲端（`supabase_dog_status`）不再存顯示座標：2026-10-09 退役（064 後沒有畫面讀它）；舊安裝留著的三個欄位不再讀寫，新安裝不建。

顯示座標快取由 `BleDisplayCoordinates.persistBleDisplayCoordinates` 依讀到的頁面補算，使用各串流在頁面前的兩筆作為平滑上下文；晚到資料會使後續最多兩筆快取失效。讀它的是即時資料（`DogDatabase` 經 `BleDisplayCoordinates.bleDisplayRows`）。第三版歷史的 `HistoryDatabase.historyDayRows` 不讀狗的平滑快取：狗以項圈原始定位建立日模型，再套用停住與歷史過濾規則；手機以 `myLocationTracker.latitude`／`longitude` 的 recorded route 建立日模型。第三版路線與游標使用日模型，不重複套用三點平滑；狗的 GPX／CSV 使用原始定位，手機使用 recorded route。

## 匯出（056，H9／H10）

- 右上匯出 icon → `HistoryExportSheet`（底部小視窗）：標題「匯出 08:03–12:11」（範圍開始到最後一筆的實際時刻）、PNG 長圖／GPX／CSV 固定順序，不標示上次使用格式。舊歷史偏好中的 `exportFormat` 不再讀取，不需遷移或清除。點一個格式，小視窗原地變成「⟳ 產生中…　取消」；失敗寫「匯出失敗　重試」；打開 Android 分享後才關。產生中點遮罩不關，返回鍵＝取消。
- `useHistoryExport`：按下那一刻把畫面的 `dayModel`（範圍、畫面上的狗都已算進去，本機和雲端資料一律合併）、顏色和名字拍成快照；地址用 `AddressLookup.lookupAddresses` 最多等 5 秒（沒網路直接寫第一行座標、第二行膠囊）；快照凍結，「重試」用同一份。暫存檔在 cache/history_exports/〈匯出 id〉/，每次匯出先清掉今天以前的。
- 純函式：`ExportSnapshot`（畫面模型 → 快照）、`ExportGPX`、`ExportCSV`、`ExportPNG`（版面、分張）、`ExportDraw`（畫圖指令，顏色只用 tokens）、`ExportFiles`（檔名、暫存、隔天清）；規則見 `ExportBuilders.md`。
- 原生 `HistoryExportPackage.kt`：量字寬、寫 GPX／CSV、照指令畫 PNG（地圖區是 Google lite 模式底圖＋自己投影畫的路線、停留編號、時間標記、比例尺、指北；底圖載不出來時空白底＋比例尺）、Android 分享（多張一次分享）。
- 拿掉的舊匯出：`HistoryExportDialog`（PNG 截目前地圖畫面＋三行字、GPX、CSV，可「儲存檔案」或分享）→ H9；`HistoryExport.serializeHistory` → `ExportGPX`／`ExportCSV`；`useMapHistory.exportRows` 與每 10 秒的查詢 → 畫面自己的 `historyDayRows`；地圖截圖 `onSnapshotReady` → 原生畫 PNG；原生 `prepare`／`save`（系統「建立文件」）→ `writeText`／`renderPng`＋分享（存檔改從分享選單選「雲端硬碟」等）。

歷史地圖只讀本機 SQLite（下載完成後由下一次刷新帶出來）；只在雲端的日子由月曆下載（054b），沒下載完的寫「資料不完整　重試」。匯出讀的是同一份本機資料，因此同樣受限。

雲端僅顯示目前登入帳號下載的 owner_user_id，不登入不讀雲端。帳號／選項變更立即隱藏舊查詢結果；雲端查詢前先完成原有 migration。先以 `owner_user_id` 隔離雲端資料，再合併本機 BLE 與該帳號的雲端列；`HistorySources` 依狗編號與封包／定位時間去重，同筆資料優先保留本機列。

第三版歷史地圖的路線由日模型（`HistoryMapModel`）直接畫出，沒有全圖段數／點數上限；超過 3 分鐘沒有資料的地方斷開，不會把前後兩段連起來。
# BLE 顯示座標

`dog_status` 原始 `slave_lat`、`slave_lon` 與 `raw_payload` 保留不變。首次讀取 BLE 顯示資料時，增加 `display_latitude`、`display_longitude`、`display_version`，依 Master／Slave 分組使用與雲端相同的最近三點平滑，高於 10 km/h 時最新點權重為 90%。無效座標或超過兩分鐘間隔會重設平滑窗口。

顯示座標在 `BleDisplayCoordinates.bleDisplayRows` 或讀取顯示座標的查詢流程中計算並另存，不在 BLE 接收時修改原始資料；Android 原生背景寫入的資料也在之後讀取時處理。第三版狗的 CSV／GPX 使用項圈原始定位；CSV 的主座標與 raw 欄位保留原始定位。手機的 CSV／GPX 使用 recorded route（`latitude`／`longitude`），CSV 另存 `raw_latitude`／`raw_longitude`，不以 raw 欄位覆寫主座標。晚到或手機時鐘調整造成的較早插入，會使同一 Master／Slave 後續兩筆顯示座標失效，下一次讀取重算。這不是異常 GPS 跳點剔除功能。
