# 手機位置記錄

設定 → 手機位置記錄 → 開始記錄。Android 定位前景服務使用常駐通知，離開畫面後繼續記錄；可在畫面或通知停止。預設關閉，不隨登入或地圖重建自動啟動。

`myLocationTracker` 位於既有 `files/databases/dogtracker.sqlite`，透過 `DogStatusStore` 同一原生 SQLite owner 寫入，與 BLE、雲端資料共用序列化交易。建表與寫入由 `android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt` 負責。首次進入頁面或開始取得定位時初始化。

- 目標每 10 秒一筆；GPS／network provider 回呼去重，以定位的 monotonic timestamp 限制頻率。
- 無新定位不補空白筆數、不重複舊定位；超過 30 秒的定位丟棄。實際頻率受 Android、接收狀況及省電影響。
- 新定位必須具有有效、有限、非負且 ≤ 5 公尺的水平估計精度；未知或超過門檻時顯示等待提示，不寫入且不推進記錄時間限制。既有低精度資料不刪除。
- `recorded_at` 和 `location_at` 是 Unix 毫秒；緯經度為十進位度；速度由 m/s 轉為 km/h。無精度／海拔／速度／方向時為 NULL。
- 每次寫入與修剪在同一交易，依 recorded_at、id 保留最新 80,000 筆。初始化也修剪舊資料。
- 畫面使用 id 游標每頁 50 筆，前景每 10 秒更新，離開頁面不再輪詢；停止記錄不刪除資料。
- 只存本機、不上傳 Supabase、不修改 dog_status 或 supabase_dog_status。
- 權限被拒時不啟動；接受粗略定位（僅 network provider）。服務只能在 App 前景啟動。系統強制停止／重開機後需再次點開始，不宣稱能永久背景執行。
- iOS 尚未實作；頁面顯示不支援。

驗收：開始記錄後移動或等待新定位，查看筆數和時間；回桌面／鎖屏後等待並返回，確認新增；停止後確認筆數不再增加；關閉 GPS 或拒絕權限確認提示；翻頁期間新資料不造成重複；上限及交易回滾由測試驗證。
