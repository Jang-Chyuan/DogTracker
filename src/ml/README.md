# DogTracker 機器學習（ML）說明

本文件依目前程式說明環境分類功能：App 使用 GPS 與 LoRa 訊號資料，推估 Slave 位於室內、窗邊或室外。推論在手機端執行，模型隨 App 打包，無須呼叫遠端推論服務；雲端資料來源仍須先同步到本機。

## 功能與用途

第三版即時地圖不顯示環境；設定 → 診斷（S8）的「每隻狗的判斷」顯示每隻狗的「目前環境」。這是環境推估，不是精確位置或活動種類辨識。QR 掃描使用的 Google ML Kit 是另一項獨立功能；活動量圖則整理硬體回報的活動值，不使用本環境模型。

## 資料流程

1. BLE 接收資料寫入 `dog_status`，Supabase 同步資料寫入 `supabase_dog_status`。
2. `CloudDatabase.latestStatusRows()` 依 Master、Slave 與資料來源查詢資料；雲端資料另限制目前帳號。
3. 找出目前時間之前，最近一個已結束且有資料的兩分鐘視窗，取出該兩分鐘內全部封包。採固定兩分鐘分桶，例如 12:00–12:02、12:02–12:04；起點包含、終點不包含，尚未結束的視窗不參與推論，空視窗會往前尋找，不要求固定封包筆數，也不要求兩個分鐘各自有資料。
4. `Environment.predictEnvironment()` 將該兩分鐘封包轉成觀測資料，交給 `inference.predictWindow()` 彙整並分類；回傳的 `samples` 就是該視窗的封包筆數。
5. 清單與詳情顯示環境、信心及模型機率；畫面標籤會檢查資料是否過期。

本機 BLE 使用 `received_at`；雲端使用 `track_at`，沒有時回退到 `received_at`。目前環境推論視窗內必須是相同 session、Master、Slave 及 UTC 兩分鐘分桶，混合視窗會拋出錯誤。分桶本身不受台灣時區顯示方式影響。即時地圖與歷史的室內停留（`src/placement/IndoorHold.js`）也用同樣的兩分鐘分桶，把結果當成「在室內」的佐證之一。

## 輸入與特徵

| 輸入 | 意義與單位 | 特徵 |
| --- | --- | --- |
| `satellites` | GPS 衛星數 | 平均值、標準差 |
| `hdop` | 已換算的 HDOP | 平均值、標準差 |
| `rssi` | LoRa RSSI，dBm | 平均值、標準差 |
| `snr` | LoRa SNR，dB | 平均值、標準差 |
| `coordinate_valid` | 座標有效為 1，無效為 0；缺少座標可為 null | 平均值、標準差 |

座標有效條件：經緯度是有限數值、緯度介於 −90～90、經度介於 −180～180，且不是 `(0, 0)`。這是座標格式檢查，不代表定位精度已驗證。

模型共有 10 個原始特徵，順序以 `model.json.features` 為準。標準差採樣本標準差（分母 n−1）；只有一筆有效值時，標準差視為缺值。HDOP 小於 0 或大於等於 655.35 視為缺值。

直接使用 `telemetryToObservation()` 轉換 Supabase 原始資料時，經緯度除以 1,000,000，HDOP 除以 100；HDOP 原始值 65535 視為缺值。手機上傳資料優先使用 `phone_received_at`，其他資料使用 `received_at`。App 的 `predictEnvironment()` 接收的是資料庫已換算欄位，避免重複換算。

## 模型與推論

目前 `model.json` 是版本 1 的隨機森林，含 300 棵決策樹，分類為 `indoor`、`outdoor`、`window`。

模型記錄的訓練視窗為 60 秒；目前環境推論明確指定 120 秒彙整，模型權重未重新訓練。兩分鐘特徵的分布可能與訓練資料不同，分類品質需要另行驗證。

推論先以模型保存的 `imputer.statistics` 補缺值，再依 `imputer.indicators` 附加缺值旗標，最後轉成 float32。每棵樹依特徵與門檻走到葉節點，取得分類機率；300 棵樹的機率取平均，最高機率類別成為模型候選答案。

預設信心門檻是 0.6：最高機率大於等於 60% 才採用模型分類，否則回傳 `unknown`。此機率不是經驗證的實際正確率。

## USB 規則與缺資料處理

若視窗內每筆封包的 `usbPresent` 都明確為 1，結果直接採用 `indoor`，來源標記為 `usb_rule`。只要有一筆為 0 或缺值，就不套用此規則。

USB 規則是「插 USB 視為室內」的產品假設；室外接行動電源也會觸發。模型仍會計算三類機率，因此 USB 規則結果可能與詳情中的模型機率不同。

若所有觀測都缺少衛星、HDOP、RSSI、SNR 與座標有效性資料，且沒有觸發 USB 規則，App 會回傳 `unknown`，避免只靠補值顯示環境答案。

## 畫面結果

| 狀態 | 顯示範例 |
| --- | --- |
| 沒有已結束兩分鐘視窗的資料 | 等待已結束的兩分鐘資料 |
| USB 規則成立 | 室內（USB 已連接） |
| 模型最高機率達門檻 | 室外（信心 85%） |
| 有訊號但低於門檻 | 疑似窗邊（信心 55%，低於 60%） |
| 缺少可用訊號 | 無法判斷 |
| 最新觀測距今超過 120 秒 | 無法判斷（資料已超過 2 分鐘） |

詳情可顯示三類機率，例如「模型機率：室內 20% · 窗邊 55% · 室外 25%」。資料過期會優先覆蓋環境標籤，包括 USB 規則結果。

回傳資料包含 `environment`、`source`、`modelEnvironment`、`modelConfidence`、`probabilities`、`samples`，App 包裝另加入 `hasSignal`、`windowStart`、`windowEnd`、`observedAt`。其中 `samples` 計算全部封包，不是有效特徵值的筆數；每個特徵的平均與標準差只使用該欄位有效值。

## 程式位置

| 檔案 | 責任 |
| --- | --- |
| [Environment.js](Environment.js) | App 欄位轉換、缺資料防護與顯示文字 |
| [inference.js](inference.js) | 時間視窗彙整、缺值處理、森林推論與原始雲端資料轉換 |
| [model.json](model.json) | 模型版本、特徵、補值參數與 300 棵樹 |
| [CloudDatabase.js](../cloud/CloudDatabase.js) | 查詢最近已結束且有資料的兩分鐘視窗 |
| [IndoorHold.js](../placement/IndoorHold.js) | 停在原處用環境結果判斷室內（第三版即時地圖不再另外顯示環境標籤） |
| [DiagnosticsModel.js](../diagnostics/DiagnosticsModel.js) | 設定 → 診斷（S8）每隻狗最近一個兩分鐘視窗的結果、三類機率與筆數 |
| [Environment.test.js](../../__tests__/Environment.test.js) | USB、缺資料、過期、低信心與犬隻資料隔離測試 |

## 驗證方式

在專案根目錄執行既有測試：

```powershell
npm test -- --runInBand __tests__/Environment.test.js
```

更換模型時，需確認版本、特徵順序、單位、補值參數、缺值旗標及類別與推論程式相容，並以固定輸入比較訓練端與 JavaScript 的分類機率。既有測試通過只證明程式行為符合測試，不代表模型在真實環境中的準確率。

## 限制與後續驗證

目前專案的 `src/ml` 保存推論程式與模型；未在本次檢視中找到可重現此模型的訓練流程、標註資料與獨立測試評估報告，因此不能宣稱分類準確率。

RSSI、SNR 會受距離、天線、發射功率、接收器與遮蔽物影響，不能單獨等同室內或室外。GPS 有效性也不能單獨證明環境類別。不同設備或部署位置可能需要重新收集標註資料與驗證。

後續訓練應保留室內、窗邊與室外的實地標籤，按採集 session、設備或地點分開訓練與測試資料，避免相鄰分鐘洩漏到測試集。評估應包含各類 precision、recall、混淆矩陣、低信心比例，以及 USB 規則啟用與停用時的結果；這些是後續建議，並非目前已完成的驗證。
