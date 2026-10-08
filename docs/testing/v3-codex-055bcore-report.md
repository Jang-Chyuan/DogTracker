# 055bcore 實作與驗證報告

已在本 worktree 完成 H7 多隻歷史及「資料來源」的純資料模型，未新增 UI 元件、未啟動 companion agents、未推送。

## 設計依據與解讀

已閱讀指定的 hist.txt、stops.txt、edges.txt、cases.txt，並核對 copy_rows.json（H7、加入、多隻、資料來源）及本專案 DESIGN.md。

- H7 僅合看狗，最多 4 隻；「我的路線」是同一套介面的獨立單一對象，不混入四隻狗名額。
- 資料來源正式選項為「全部／這支手機收到的／雲端」，預設全部。設計未列獨立的「本機」或「接收器」選項，因此沒有自行增加。
- 選項即使無資料仍可選，另外提供 available 供呼叫端判斷；保留使用者明確選擇，避免換日期時偷偷換來源。H8 仍顯示來源列，我的路線隱藏。
- 沿用 055a 的加入順序及四個路線色槽：從入口加入的狗先取第一槽，新狗取最小空槽；切換主角、換資料、移除其他狗不改變留在選取集合內的 dogId 顏色。移除後空槽可回收，並非永久跨畫面的狗色。頭像沿用呼叫端狗資料，不另造頭像系統。

## 實作

- `HistoryMultiSelection.js`：重用 HistoryScreenDogs 的選取、加入／移除、主角與顏色邏輯；提供膠囊、加入清單、四隻限制、空清單與我的路線模型。
- `HistoryMultiModel.js`：重用 screenDayModel、historyTimeline、screenCursor、historyMapPresentation 與 emptyState。每隻在共同範圍內各自計算路線、停留編號、距離摘要及游標，禁止把不同對象的原始定位混成一條路線。
- 螢幕時間軸只跟隨主角；各隻完整模型仍供下游摘要／匯出使用。相機集合框住所有有資料的對象；非主角路線為 3dp，游標之前 50%、之後 20%，車段保留 2dp。途中時間標記只顯示主角游標之前，起訖仍保留。空對象不畫地圖；過期游標停最後實測位置，沿用灰圈及「這段沒資料」標籤。
- `HistoryMultiSources.js`：單一對象／日期的封包來源可用性、尚未下載的雲端日期中繼資料、預設選擇、即選即關與 pill 文案。
- screen/index.js 匯出新 API；新增三個 HistoryMulti 測試檔。

## 呼叫契約

multiDayModel 的 subjects 為 `{ id, name, colour, subject?, rows, options? }`，rows 須由資料層依對象分組，保留既有午夜前後上下文。options 提供日界、今天／現在、共同 range、protagonist、cursorTime 與 source；未提供 range 時以主角的單隻模型自動範圍為準。回傳主角清單、各隻模型／摘要／地圖、共同範圍及游標、相機點集合與匯出可用性。手動範圍記憶仍由既有 RangeMemory／rangeOwner 管理。

multiSourcePicker 接受單隻 rows；混合 raw rows 時可提供 subjectId 比對 slave_id。未標 slave_id 的 rows 視為呼叫端已分組的資料。availability 以封包而非 GPS 座標為準，室內／狀態封包也算；cloudAvailable 是呼叫端提供的該日、該對象雲端紀錄資訊，不執行下載或網路請求。

## 驗證

- `npx jest __tests__/HistoryMulti --runInBand`：3 suites、12 tests 全通過。
- `npx jest --testPathPattern='History|history' --runInBand --silent`：29 suites、273 tests 全通過。
- `npx eslint src __tests__`：通過，無警告／錯誤。
- `git diff --check`：通過。

涵蓋加入順序、重複加入、滿額、色槽／頭像保持、移除主角與最後一隻、無資料主角限制、我的路線、正式來源文案、日期界線、對象篩選、雲端中繼資料、空來源選取、共同範圍交集、距離與既有演算法一致、停留各自編號、缺口不連線、共用游標過期／尚未開始、全空與範圍空資料，以及換來源後重新判定主角。

未執行 UI／裝置操作；本任務交付純模型及單元測試。既有 SQLite 測試的實驗性功能提示不影響測試結果。
