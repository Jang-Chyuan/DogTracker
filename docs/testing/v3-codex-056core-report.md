# 056core：v3 歷史匯出純函式

已完成 H9/H10 的獨立純函式 builder，未接 UI、未修改 Android 模組、未啟動協作代理、未推送。

## 實作

- `ExportData.js`：共用快照契約、同一天範圍驗證、原始 GPS 選取、對象篩選、時間裁切。停住期間沒有 GPS 的封包仍算有資料；GPX/CSV 不輸出其顯示用座標。
- `ExportGPX.js`：GPX 1.1、UTC；每個對象一條移動 trk，每次坐車／開車另外編號 trk，type=drive。超過三分鐘、中斷、室內停住／放開、交通方式邊界及記錄 session 切換分 trkseg，保留全部原始點。停留 wpt 使用清單編號、扣除中斷時間；室內 wpt 使用停住代表位置，按範圍裁切並在沒有資料處拆開，未知地址不寫 desc。只剩室內停住資料時可輸出只有 wpt 的 GPX。
- `ExportCSV.js`：保留指定 24 欄、UTF-8 BOM、CRLF、引號跳脫，缺值留空；原始座標，所有狗合併一份 CSV，UTC 定位時間排序，同時間依 slave_id。我的路線 source=phone，項圈欄位留空。
- `ExportPNG.js`：1080px 寬、第一頁 1080×1080 地圖、內容裁切高度，上限 2400px；包含標題、可換行圖例、狗段頭、時間軸列與 60px 頁尾。跨頁只對被切開的狗加「（續）」；段頭與第一列一起換頁，第一頁不足時只留地圖。後續頁重複標題、圖例、頁碼。長地址最多兩行省略；只有一隻有資料時採單狗版面。文字色直接使用 `src/theme/tokens.js` 的 light tokens。
- `ExportFiles.js`：設計檔名、非法字元替換、PNG 頁碼、唯一暫存目錄描述，以及次日本地日曆日期的清理判定；不直接讀寫檔案。
- `ExportBuilders.md`：輸入、輸出、半開區間、原始座標、量字介面與後續接線責任。

## 設計核對與介面界線

已搜尋 hist.txt、edges.txt、designmd.txt、spec.txt 的 GPX／CSV／PNG／匯出／wpt／trkseg／trk，閱讀 H9/H10、範圍、停住、坐車及 PNG 補充規則，並核對現有 HistoryExport.js、HistoryExportButton.js 與 Android HistoryExportPackage.kt。

另外唯讀核對本地 main：其舊版 CSV 為 18 欄，本 worktree 的現有 serializer 已是 24 欄；依 spec.txt 明列的 24 欄及本 worktree 現況實作。既有 serializer 使用平滑座標、Android 暫存七天；此次新增 builder 使用原始座標及隔天清理規則，供後續替換，原有流程仍保留。

builder 接收已選來源、去重、對齊實測點、計算停留與時間軸的匯出快照；不重做資料庫或停留判定。一般停留的代表位置需由上游按選定範圍重算；builder 再執行範圍裁切及中斷時間扣除。PNG 是 renderer 可繪製的版面模型，沒有產生點陣圖片；可傳入 App 字型的純量字函式，預設提供保守估算。地址查詢、地圖投影、分享及實際刪檔留待後續接線。

## 驗證

- `npx jest __tests__/Export`：1 個 suite、13 個測試通過。
- `npx eslint src __tests__`：通過，無錯誤或警告。
- `git diff --check`：通過。

測試包含深凍結快照、XML 跳脫及元素順序、原始座標、UTC、三分鐘邊界、室內分段、每次坐車 trk、wpt-only、停留中斷扣除、範圍兩端、延遲 GPS 歸段、CSV 排序／缺值／引號／手機欄位、PNG 單狗與多狗分頁、長圖例與地址、第一頁不足、續段、無資料對象、檔名與跨午夜清理。
