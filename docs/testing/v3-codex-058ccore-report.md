# 058ccore 純模型實作報告

完成 N3 提醒卡、歷史事件投影、返回快照與通知點擊目的地；沒有加入 React、UI、原生通知或背景生命週期接線。

## 實作

- `src/alerts/AlertsHistory.js`：事件轉成時間軸與地圖標記；依時間範圍、狗 ID 篩選、去重，解除事件不當成新提醒，升級事件保留。標記只用事件當時的 `coordinate`，無座標或非有限數值時只留時間軸。
- N3 使用既有 `scheduleAlerts` 的 `effects.cards`，沿用通知文案與目的地；前景且非即時地圖才顯示，五秒到期，無按鈕、無關閉操作。接收器低電量只計入 `⚠ N`；解除或不同 episode 的卡片不顯示。
- 通知點擊先進即時地圖，再依現有嚴重度開狗卡、接收器設定、系統儲存空間或診斷。忽略 `present: false` 電量 latch，沒有有效提醒時只回地圖。
- `src/alerts/BackSnapshot.js`：捕捉可序列化且與來源分離的 checkpoint，重用 DogFreshness、DogProblems、既有 AlertEvents。可直接輸入 merged dogs，或提供持續追蹤的 active 事件以保留 episode／電量升級資訊。
- 返回差異包含新問題、升級、解除後再發生與恢復；可提供 `(離開時間, 返回時間]` 的事件紀錄，以保留離開期間已發生又解除的問題。先排目前仍存在的問題，再排已解除問題，各組依嚴重度和穩定 key 排序；狗分組順序依第一項問題。刪除或從未定位的狗不誤顯示為恢復。無變化回傳 `null`。

## 設計依據與假設

讀取指定 notif.txt、hist.txt、edges.txt、cases.txt 與 copy_rows.json，沿用 c168 等既有提醒文案。這四個設計檔與 copy deck 並未定義「返回快照／離開期間」的具體規則或文案；因此快照採問題差異模型，提供 `active`／`resolved` 結構化狀態，不自行發明返回卡標題或恢復文案。一般位置移動、一般電量讀數變化不產生返回摘要。

此分支沒有 `src/history/`，故歷史投影放在 alerts 內，沒有複製既有歷史模組。既有 058a 的事件、排程及通知內容沒有修改。

端點比較無法推知離開期間短暫發生的事件，必須由呼叫端提供事件紀錄。僅提供原始狗狀態時無法可靠重建 episode 起點，因此不以每次捕捉時間當成再次發生；精確 episode 辨識應傳入 AlertEvents 的 active。每個問題 key 彙整一項摘要，完整事件仍可由歷史投影呈現。座標與事件時間需由呼叫端一同保存，模型不從目前位置倒推。

## 驗證

- `npm test -- --runInBand --testPathPattern='(Alert|BackSnapshot|DogFreshness|DogProblems|ReceiverRange)'`：7 suites、160 tests 全部通過（含所有 alert 測試）。
- `npx eslint src __tests__`：通過，無警告或錯誤。
- 覆蓋精確文案、五秒邊界、badge-only、目的地優先序、時間窗、事件去重、空資料、不可變性、序列化、雲端下載時鐘、室內封包判定、升級、瞬間事件與狗排序。

未啟動 companion agents，未推送，所有新增檔案皆在指定 worktree。
