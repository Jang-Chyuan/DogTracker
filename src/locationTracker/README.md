# 手機位置記錄

另存 display_latitude/display_longitude、display_source、display_location_at。前景即時藍點每 100 ms 向原生記憶體提供動畫座標，原生 writer 依原有 1/3/5 秒節奏在同一交易另存。僅接受同 session、來源定位不晚於本筆且差距 ≤ 3 秒、快照接收時間距今 ≤ 1.5 秒的座標；無有效快照時保存定位管線位置並標示 pipeline。歷史動畫不回寫，原有 latitude/longitude 和 raw_latitude/raw_longitude 不覆寫。第三版歷史與 CSV／GPX 使用 recorded route（`latitude`／`longitude`）；display 座標與來源另存供診斷，CSV 另含來源與來源定位時間。

預設啟用：App 進入前景、已取得精確定位權限且 GPS 開啟後，自動啟動 Android 定位前景服務，使用常駐通知，離開畫面後繼續記錄。首次及舊版升級未有偏好時使用此預設；尚未授權時沿用 App 的定位權限流程，不額外重複要求權限。

設定 → 手機位置記錄及通知的「停止記錄」都將原生 `phone_location_recording.enabled` 設為 false；停止狀態跨導航及 App 重啟保留，需手動按「開始記錄」才重新啟用。系統終止或重開機不更改使用者偏好，已啟用者在下次開啟 App 且定位可用時恢復；不會僅因手機開機就自行啟動。地圖重建不重新建立正在執行的定位服務。

`myLocationTracker` 位於既有 `files/databases/dogtracker.sqlite`，透過 `DogStatusStore` 同一原生 SQLite owner 寫入，與 BLE、雲端資料共用序列化交易。建表與寫入由 `android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt` 負責。首次進入頁面或開始取得定位時初始化。

- 有可用 Google Play Services 時使用 Google Fused Location Provider；否則 Android 12+ 有 framework fused 時使用它，其餘依可用 GPS／network provider。這是來源選擇，並不保證 Google Maps 相同的室內推論。約每秒要求一次高精度定位；以 monotonic timestamp 排除重複或倒序樣本。SQLite 依原始 GPS 速度調整保存間隔：≤ 10 km/h 每 5 秒、> 10 且 ≤ 20 km/h 每 3 秒、> 20 km/h 每 1 秒；速度未知則每 5 秒。以最新速度與上次成功寫入時間判斷，不受靜止歸零影響。最多 80,000 筆，高速持續每秒保存約可保留 22.2 小時。
- 無新定位不補空白筆數、不重複舊定位；超過 3 秒的定位丟棄。實際頻率受 Android、接收狀況及省電影響。
- 新定位必須具有有效、有限、非負的水平估計精度；原始速度 > 20 km/h 時要求 < 50 公尺，其餘情況要求 ≤ 30 公尺；未知或超過門檻時顯示等待提示，不寫入且不推進記錄時間限制。既有資料不刪除。
- 最近 3 個有效樣本平均；速度 > 10 km/h 時，最新點權重為 90%。超過 3 秒的樣本間隔重設平滑視窗。平滑不代表實際精度提高；估計精度仍保留定位來源回報值。
- 即時地圖由 `useLiveLocation` 每秒讀取原生記憶體快照；診斷記錄清單由 `useLocationTracker` 呼叫 `readPage` 讀取 SQLite，每次讀取完成後 10 秒再讀。歷史由 `HistoryDatabase.historyDayRows` 讀取 SQLite 的日期資料，不使用即時記憶體快照。
- `raw_latitude`、`raw_longitude` 保留被保存樣本的原始座標；`session_id` 區分每次記錄。歷史地圖與 GPX 在工作階段切換或超過 3 分鐘間隔時分段。
- `LocationTrackerScreen` 是設定 → 診斷 → 記錄清單的分頁清單；日期／時間範圍與匯出在 `src/mapHistory/HistoryScreen.js`。第三版手機 CSV／GPX 以 recorded route 為主座標，CSV 另保留 raw 欄位；裁切與時間用途見 `../mapHistory/ExportBuilders.md`。每秒樣本僅用於定位管線，不全部存入資料庫。
- `recorded_at` 和 `location_at` 是 Unix 毫秒；緯經度為十進位度；速度由 m/s 轉為 km/h。無精度／海拔／速度／方向時為 NULL。
- 每次寫入與修剪在同一交易，依 recorded_at、id 保留最新 80,000 筆。初始化也修剪舊資料。
- 畫面使用 id 游標每頁 50 筆，前景每 10 秒更新，離開頁面不再輪詢；停止記錄不刪除資料。
- 只存本機、不上傳 Supabase、不修改 dog_status 或 supabase_dog_status。
- 需要精確位置權限與 GPS；不接受只有粗略位置權限。服務只能在 App 前景啟動。系統強制停止／重開機後需再次點開始，不宣稱能永久背景執行。
- iOS 尚未實作；頁面顯示不支援。

靜止判定確認後速度歸零，顯示與儲存座標鎖定於確認當下的平滑位置；原始座標持續保留供移動判定。PhoneMotion 的 JS 歷史回放與 Kotlin 即時記錄維持相同判準：有有效速度精度時，低速證據要求位置精度 ≤ 30 m、速度 ≤ 1 m/s、速度精度 ≤ 1.5 m/s，且速度減誤差 ≤ 0.5 m/s；缺速度精度時只接受位置精度 ≤ 10 m、速度 ≤ 0.3 m/s。至少15秒疑似、20秒確認；高精度樣本另檢查3 m的單向進展，中精度樣本依精度放寬靜止視窗，避免室內小幅飄移冒充離開。

可信速度持續3秒可解除停留。缺速度或錯誤零速不代表走路；須有足夠長、品質合格、持續同方向的幾何進展才能確認移動，高精度以20秒視窗，中精度使用2–10分鐘的有界視窗。離開後的重新停留也保留進展反例，不能一直把真正的慢走鎖回原地。超過30秒沒有連續觀測會重置這個 motion detector 的證據；定位 writer 仍只保存新鮮合格樣本，不補空白筆。失去低速證據超過3分鐘則回到未知。這些判準是保守啟發式，原始點不改寫，回放及模擬器結果不能代替實際室內／步行真值。

歷史另外使用已確認停留的顯示錨點，让停留內的地圖游標與END共點；裁切完全在停留內時可保留不編號的顯示證據。原始訊號缺口、真正的短走與車程不得借用這個錨點掩蓋。手機motion不拿來判定狗項圈在室內。
新欄位 raw_speed_kmh、speed_accuracy_mps、motion_state 保留原始速度、速度估計精度與狀態，包含於 CSV；舊資料為 NULL，不回填推測狀態。速度精度單位為 m/s，速度欄位為 km/h。

驗收：開始記錄後移動或等待新定位，查看筆數和時間；回桌面／鎖屏後等待並返回，確認新增；停止後確認筆數不再增加；關閉 GPS 或拒絕權限確認提示；翻頁期間新資料不造成重複；上限及交易回滾由測試驗證。
