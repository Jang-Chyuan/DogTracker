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

## 2026-10-08：設計逐條回查與補測

重新唯讀閱讀指定 hist.txt、edges.txt、spec.txt，搜尋 GPX、CSV、PNG、匯出、wpt、trkseg。以下列出匯出規則及測試；重複的設計條文合併列出。範圍保持 fca8967 的純 builder／版面契約，不接 v3 UI、不改 native、不推送、不啟動 companion agents。每個 Export 測試上方都有設計原句與檔名／行號。原先 13 tests 現為 35 tests。

修正：CSV 保留選定範圍內所有封包（無原始 GPS 時欄位空白），用記錄 UTC 排序；僅觸及範圍邊界的區間不產生 0 分鐘 wpt；PNG 長地址和詳細文字不再兩行截斷，依內容長高，單列超過整頁容量明確拒絕；PNG 補足字重、App 字型、地圖比例尺／指北／署名位置／原色／不連缺口／室內代表點契約，以及節點實際時間、地址失敗文字。新增深複製／凍結快照及純地址 deadline decision（無網路／錯誤立即失敗，5000ms 逾時）。

### Rule → test（純函式與 renderer 契約）

B = `__tests__/ExportBuilders.test.js`；R = `__tests__/ExportRules.test.js`。表中英文為 Jest test 名称。

| 設計句子／來源 | 核對結果與責任 | Test |
| --- | --- | --- |
| hist:9「匯出選的範圍（同一天）」；spec:486「匯出用選的範圍」 | builders 驗證同一當地日；GPX 用 GPS acquisition time，CSV 用封包記錄時間裁切 | B: range is inclusive…；invalid or cross-day…；R: CSV selected recording range… |
| edges:40「資料本身不到 1 分鐘…匯出照實際筆數算」 | 單點／短範圍有效，不要求兩筆 | R: empty day returns no content… |
| hist:242「沒有紀錄…匯出變淡」；spec:487「沒資料的狗…不算進隻數、不畫、沒有清單段」 | 無資料輸出沒有 pages／trk／CSV data rows；停住封包仍算有資料；icon 是 UI 責任 | B: only one active dog…；R: hold-only dog counts…；empty day… |
| spec:488「GPX 1.1，時間用 UTC」 | 版本、namespace、UTC ISO、XML escaping、wpt 在 trk 前 | B: GPX exports raw unsimplified coordinates… |
| spec:488「每隻狗一條移動的 trk（名稱『小黑-4』）」 | 名字＋訊號源；多狗一檔 | R: multi-dog GPX separates names… |
| spec:488「每一次坐車各自一個 trk…type＝drive」；spec:416 同句 | 各次坐車編號，前後移動分段 | B: walking, indoor drift…；R: multi-dog GPX… |
| spec:488「我的路線…遇到中斷或開車都分成不同的 trkseg…每一次開車各自一個 trk」 | phone 名稱、兩次 drive、同 drive 內 gap 分段 | R: phone driving gaps retain…；B: stay duration excludes… |
| spec:222「歷史的缺口…超過 3 分鐘」；spec:488「中斷…不同的 trkseg」 | 3 分鐘連線；>3 分鐘、session、explicit gap、無有效 GPS 分段 | B: exactly 3 minutes stays connected… |
| spec:376「停住時結束目前的 trkseg…室內飄移…另開…放開後…新的 trkseg」；edges:49 | hold／release 半開區間、raw 點保留 | B: walking, indoor drift…；R: dense raw indoor drift… |
| spec:391「GPS 點照它自己的定位時間歸到那個時間的區間」 | 不用延遲封包時間分類 trkpt | B: range is inclusive…；R: dense raw indoor drift… |
| spec:488「停留是 wpt…時間＝停留開始、desc＝地點…不含中斷 5 分」；spec:101／213／240 | 保留上游清單編號及代表位置；扣裁切後 gap | B: GPX exports raw…；stay duration excludes… |
| spec:319／488「停在原處也是 wpt…座標＝停住點…裁切後…中間有沒有資料…每段各一個…查不到就不寫」；spec:394 | 使用 hold 代表點，range clipping、gap splitting、omit desc、wpt-only | B: hold-only exports clip duration…；R: range touching a hold… |
| edges:48「在 00:00 切開」；spec:274「每天只算自己那一段」 | 當地午夜分日，跨日 hold 在各日範圍裁切，GPX UTC | R: midnight hold is clipped independently… |
| spec:415／488「沿著手機路線畫的那段不寫（原始資料裡沒有項圈座標）」 | raw null 不 fallback 至 phone display coordinate | R: CSV retains GPS-less indoor… |
| spec:489「UTF-8…24 欄…沒值留空」 | exact literal header、每欄保存、BOM、CRLF、quoted escaping | B: CSV retains 24 columns…；R: CSV exact design header… |
| spec:489「停在原處、在車上沒定位…CSV 照樣寫原始座標」；edges:49 | 不平滑／不簡化／不替換 displayed coordinates；缺 GPS 也保留封包 | R: CSV retains GPS-less indoor…；dense raw indoor drift… |
| spec:489「我的路線…source 填 phone…項圈欄位留空」 | 同 24 欄，清空 master/slave/satellites/hdop/rssi/snr | B: CSV retains 24 columns… |
| spec:264「所有列照時間（UTC）由舊到新；同一時間再照 slave_id」 | 使用記錄時間；同時依 slaveId | R: CSV sorts packet recording time…；B: CSV retains 24 columns… |
| hist:315／spec:483／495「單狗標題…狗名（訊號源 4）＋日期起訖、距離」 | 單狗無圖例／段頭；phone 名稱 | B: PNG single subject…；only one active dog…；R: PNG endpoint time…；phone PNG preserves… |
| hist:315–318／spec:487「狗的歷史（N 隻）…圖例…每隻一段…段頭…起訖…距離」 | 只計 active subjects，route color、distance、section metadata | B: multi-dog pagination…；R: hold-only dog counts… |
| hist:317／spec:252／272「停留編號各自從 1…自己的顏色…框住全部…四邊留 24dp」 | map 保存各狗 stays 原編號；fit=all-routes-and-stays、72px padding、routeColors；上游編號判定 | B: multi-dog pagination…；R: PNG map contract specifies… |
| spec:483「起終點時間、途中時間標記（多隻狗時不畫）、停留編號、比例尺、指北、地圖署名」 | 明確 renderer 契約；single all／multi endpoints | R: PNG map contract specifies…；B: multi-dog pagination… |
| spec:49／486「開車、坐車…路線色實線、中斷不連線…不畫游標」 | solid drive width 6px、movement 12px、no cursor、no fading、gap 不連 | R: PNG map contract specifies… |
| edges:49「PNG 照畫面畫在停住點」 | holds=representative-position 且保留代表點 | R: PNG map contract specifies… |
| spec:426「沒有底圖時用空白底＋比例尺」；spec:140／485「署名…地圖區右下角…跟著地圖」 | blank-with-scale；bottom-right；僅第 1 張 map 有署名 | R: PNG map contract specifies…；B: PNG single subject… |
| spec:244／486「終點寫最後一筆的實際時刻…不寫現在」 | row.timeText 用 row.end/time/start；label 現在→結束；不是 snapshot.until | R: PNG endpoint time is sample time… |
| spec:482「1080px…1080×1080…標題120…圖例56…段頭72…移動96…節點140…頁尾60」 | 維持最小尺寸，依文字長高；頁高裁切 | R: PNG dimensions, typography…；B: PNG single subject… |
| spec:160／180／484「三欄…150／80…40／36／30…64／72…圖例28…段頭36／28…頁尾24…App字型」 | PNG_STYLE sizes、weights、fontFamily 契約及 tokens | R: PNG dimensions, typography… |
| spec:392「點直徑9…間距21…實線9…虛線6（18／12）」 | timeline style constants | R: PNG dimensions, typography… |
| spec:127／160「查不到地址…第一行座標…第二行…查不到地址」 | coordinates title、badge 保留、detail muted、wrap | R: PNG missing address keeps… |
| edges:34「沒網路就不查…不等5秒」；spec:127「最多等5秒…逾時或出錯…查不到」 | 純 deadline decision；外部實際 request/timer 由 caller 擔任 | R: address deadline is immediate offline… |
| spec:127／485「超過2行…往下推…清單列依內容自動長高」 | address/detail 全部 wrap，不再截斷；超大 row 拒絕而非輸出超高頁 | R: PNG preserves long details…；B: PNG wraps legend, preserves long addresses… |
| spec:132／152／485「累計高度…超過2400…不限列數…依內容裁切」 | 恰好2400留本頁，超過分頁；計 title/legend/section/footer | R: exact 2400 pixel page fits…；B: PNG single subject… |
| hist:319／edges:35／spec:485「每張…日期、範圍、狗名…圖例、頁碼」 | repeat title/legend、footer page | B: multi-dog pagination…；R: exact 2400 pixel page fits… |
| hist:318／spec:485「被切開…（續）…新的一張開始…一般段頭」 | split dog continuation；新 dog ordinary header；single 無段頭 | B: multi-dog pagination…；R: exact 2400 pixel page fits… |
| spec「PNG 第1張放不下清單…只放標題、圖例、地圖、頁尾」 | section 和 first row 一起移至第2頁 | B: PNG wraps legend, preserves long addresses… |
| spec:483「清單…和畫面…一樣…頁尾『停留＝待得比這條路線一般地方久很多的地方』」 | 保存 snapshot.timeline 所有欄位（含 gap／transport detail），固定 footer 文句 | R: PNG dimensions, typography…；PNG endpoint time… |
| spec:405／86「快照包含…停住判斷和地址…重試…同一份」 | captureExportSnapshot 深複製深凍結；更新 live 不影響輸出 | R: captured immutable snapshot preserves… |
| hist:320／spec:490「三種格式同一個主檔名…PNG多張_1、_2…非法字元_」 | local timestamps、phone／dog／multi、僅一 active dog 用名字 | B: filenames, multi PNG suffix…；R: all formats share local filename… |
| 原 fca8967 temp-file contract（指定三份設計無暫存檔清理句子） | unique exportId、path validation、次日本地日曆清理；不冒稱設計規則 | B: filenames, multi PNG suffix…；R: cleanup handles year boundary… |

### 原始設計中的 UI／platform 規則（不以 pure tests 冒稱完成）

完整匯出功能仍有下列接線責任；fca8967 明確尚未替換既有 `HistoryExport.js`／Android。以下不是 builder 缺少的序列化分支，也沒有把純模型測試當作實際 App 驗收：

| 原始設計規則 | 實作／驗證狀態 |
| --- | --- |
| hist:3／9／237／248／330；spec:117／118／460：右上固定分享箭頭 icon；多狗膠囊捲動仍固定；選格式→分享 | v3 UI 尚未接線；不能由 Export tests 驗證位置、操作或 native 分享 |
| hist:245–247；spec:53／55／73／122／208：PNG 長圖／GPX／CSV 選項、副文案、上次用記號、小視窗／單選尺寸與 range 標題 | v3 chooser 尚未接線；純 builders 只驗證三種格式與名稱 |
| spec:66／86／175：產生中20dp轉圈、停用icon、保留小視窗、取消／返回＝取消、不能改範圍、分享時才關閉 | 沒有 v3 generation UI state machine；本次只實作可重試的 frozen snapshot |
| spec:98／hist:242：40%停用與 TalkBack「這天／這段時間沒有紀錄／正在下載」 | pure 空內容判定有 tests；opacity、TalkBack、download gating 尚需 v3 UI tests |
| spec:127：真實地址 request 不超過5秒、離線不發 request、查詢中2行佔位／180ms淡入與高度過渡 | deadline 決策有 test；真實網路 timer／取消與動畫未接，不能稱 end-to-end timeout 已驗證 |
| spec:160／483／484：同一時間軸元件、App真實字型、地圖投影與實際 PNG 點陣繪製／地圖署名 | 本次提供 renderer 契約與 tests，尚未產生 bitmap；需 renderer/native 視覺驗證 |
| spec:220／227／232／234／240／242／258／350／391：來源篩選去重、範圍 snapping、距離、停留重播與代表位置、交通切換編號、午夜時間軸節點 | 輸入契約：上游必須提供同畫面算好的 range snapshot；本次驗證保留／裁切，未重做 tracking 判定 |

結論：純 builders 與新增純 decision helpers 的規則有對應 regression tests；完整 v3 匯出 UI、地址 I/O、renderer／分享／實際刪檔仍未實作或驗收，不能宣稱「設計所有 App 規則均已完成」。

### 本次驗證

- `npx jest __tests__/Export --runInBand`：2 suites、35 tests passed。
- `npx eslint src __tests__`：clean（全 src／tests，不只改動檔）。
- `git diff --check`：clean。
