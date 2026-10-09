# 第三版匯出純函式（H9／H10）

這些模組不存取 React Native、SQLite、網路、檔案、時鐘或亂數。`useHistoryExport` 負責串接：`ExportSnapshot.buildExportSnapshot` 從歷史畫面的日模型建立快照，`ExportDraw` 將 PNG 版面轉成 `HistoryExportPackage.kt` 的繪圖指令。

## 快照契約

所有 builder 接受 `{ since, until, timeZone: 'Asia/Taipei', subjects: [...] }`。時間為有限的 Unix 毫秒；範圍含兩端，範圍控制器已對齊實測點／停住封包。兩端須在 `timeZone` 的同一天（省略時預設 UTC；App 傳入 `null`，表示手機時區），使用實際時間，不傳持續移動的「現在」。短範圍與單點仍可匯出。

每個 subject 包含：

- `kind: 'dog' | 'phone'`、`name`、`slaveId`、`distanceKm`、`routeColor`。
- `rows`：完整、已依來源隔離並去重的封包／GPS 紀錄，可使用 CSV 的 snake_case 欄位。`time` 為封包／記錄時間；無 `time` 時使用 `recorded_at`，再退回 `location_at`。`location_at` 為 GPS 取得時間。
- 狗：有 `raw_latitude`／`raw_longitude` 時各自以該欄為準，包含明確的 null；未提供時使用 `latitude`／`longitude`，呼叫端須放項圈原始定位（`slave_lat`／`slave_lon`），不可放顯示座標或手機推導位置。
- 手機：主座標使用 recorded route 的 `latitude`／`longitude`，與第三版歷史和「今天 x km」相同；允許定位管線處理後的座標。`raw_*` 只寫入 CSV 的 raw 欄位，不覆寫主座標。
- `holds`、`stays`、`rides`、`gaps`：`{start,end}` 區間陣列。停住／坐車分類不含 end，放開／下車歸移動。gaps 是互不重疊的無資料區間。holds 使用代表位置 `latitude`、`longitude` 與可選 `address`；stays 另有共用時間軸 `number`（包含交通切換節點）。停留偵測與代表位置須依選定範圍重算；holds 保留偵測出的停住位置。
- `timeline`：畫面依範圍計算的清單列，保留時間、編號與座標等欄位。PNG 使用 `exportTimelineRows` 的 title、pill、coordinates、不含中斷、movement lead/time/rest；匯出將「現在」改為「結束」。

是否有資料以範圍內的封包時間判斷，沒有有效 GPS 的停住封包仍算有資料。GPX 依封包時間選入（含兩端），GPS 時間用於排序、停住／坐車分類與 trkpt 時間；多個封包重複的同一定位只輸出一次。CSV 同樣依封包／記錄時間選入，但排除 `rawCoordinate(row, subject)` 無有效座標的列：狗檢查原始定位，手機檢查 recorded route。匯出不再插值、平滑或降採樣，不可傳入受繪圖額度裁切的幾何資料。

## 函式

- `buildGPX(snapshot)`：GPX 1.1 XML，時間為 UTC，waypoints 在 tracks 前。每個 subject 一條移動 track，每段匯出的坐車區間另有編號 drive track。停住／坐車邊界、session 切換、明確缺口、缺 GPS 或 GPS 間隔超過 3 分鐘會分段。停住 waypoint 裁切到範圍並避開缺口；停留時間／說明扣除清單的 `interruptionMs`（快照中的 `excludedMs`）。
- `buildCSV(snapshot)`：UTF-8 字串，含 BOM、CRLF 與 24 欄表頭；儲存格加引號並跳脫，缺值留空。依記錄時間（UTC）、slave ID 排序。手機 source 為 `phone`，狗為 `dog-N`；手機的項圈專用欄位留空。狗的主座標使用原始定位，未提供 raw 欄時 raw 欄也填同一定位；手機主座標使用 recorded route，raw 欄保留獨立原始值。
- `buildPNGLayout(snapshot, {measureText})`：1080 px 寬，輸出版高、地圖／段頭／清單列區塊位置與頁尾。`measureText(text, fontSize, bold)` 是可選的同步純量字函式；預設量測固定且保守，實際繪圖應使用原生字型量測。標題兩行（主角；日期、時段、距離），圖例座標相對於標題下方圖例區。地址與內容一般換行；單列高於整頁可用高度時，先將地址／title 截為兩行並加省略號，截短後仍放不下才回報高度錯誤。使用 `PNG_STYLE` 與 App 淺色 tokens。只有第一頁有方形地圖，後續頁重複標題／圖例。地圖 padding 為 128 px（避開指北圖示並保留端點標籤空間）；多狗只畫端點時間標記，單一主角畫所有時間標記，不畫游標或游標淡化；保留底圖來源標示，底圖失敗時空白底＋比例尺。這是繪圖契約，不是 bitmap 或投影實作。
- `buildExportFilename(snapshot, format, page?)`：共用基本檔名、本地時區範圍時間，取代不合法字元；只有分張 PNG 加頁碼。
- `buildTempFile(snapshot, format, {createdAt,exportId,page})`：相對 cache 目錄與檔名描述。平台決定 cache 根目錄，呼叫端提供唯一 `exportId` 隔離同時執行的匯出；此函式不寫檔。
- `shouldCleanupExport({createdAt}, now, timeZone)`：下一個本地日曆日開始回傳 true，不是經過 24 小時或七天才到期。平台只列舉並清理匯出快取；無效日期回傳 false。

`captureExportSnapshot` 在選定匯出時複製並深度凍結快照，重試沿用同一份。`exportAddressState` 不做 I/O 或計時，只判斷離線、失敗或 5000 ms 期限；呼叫端負責剩餘期限與取消請求，既有快照地址保留。地址查詢、停住偵測、範圍對齊、繪圖、分享與檔案清理由呼叫端／平台負責。
