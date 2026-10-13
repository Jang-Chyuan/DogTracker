# 手機位置記錄

另存 display_latitude/display_longitude、display_source、display_location_at。前景即時藍點每 100 ms 向原生記憶體提供動畫座標，原生 writer 依原有 1/3/5 秒節奏在同一交易另存。僅接受同 session、來源定位不晚於本筆且差距 ≤ 3 秒、快照接收時間距今 ≤ 1.5 秒的座標；無有效快照時保存定位管線位置並標示 pipeline。歷史動畫不回寫，原有 latitude/longitude 和 raw_latitude/raw_longitude 不覆寫。第三版歷史與 CSV／GPX 使用 recorded route（`latitude`／`longitude`）；display 座標與來源另存供診斷，CSV 另含來源與來源定位時間。

預設啟用：App 進入前景、已取得精確定位權限且 GPS 開啟後，自動啟動 Android 定位前景服務，使用常駐通知，離開畫面後繼續記錄。首次及舊版升級未有偏好時使用此預設；尚未授權時沿用 App 的定位權限流程，不額外重複要求權限。

設定 → 手機位置記錄及通知的「停止記錄」都將原生 `phone_location_recording.enabled` 設為 false；停止狀態跨導航及 App 重啟保留，需手動按「開始記錄」才重新啟用。系統終止或重開機不更改使用者偏好，已啟用者在下次開啟 App 且定位可用時恢復；不會僅因手機開機就自行啟動。地圖重建不重新建立正在執行的定位服務。

`myLocationTracker` 位於既有 `files/databases/dogtracker.sqlite`，透過 `DogStatusStore` 同一原生 SQLite owner 寫入，與 BLE、雲端資料共用序列化交易。建表與寫入由 `android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt` 負責。首次進入頁面或開始取得定位時初始化。

- 有可用 Google Play Services 時使用 Google Fused Location Provider；否則 Android 12+ 有 framework fused 時使用它，其餘依可用 GPS／network provider。這是來源選擇，並不保證 Google Maps 相同的室內推論。約每秒要求一次高精度定位；以 monotonic timestamp 排除重複或倒序樣本。SQLite 依原始 GPS 速度調整保存間隔：≤ 10 km/h 每 5 秒、> 10 且 ≤ 20 km/h 每 3 秒、> 20 km/h 每 1 秒；速度未知則每 5 秒。以最新速度與上次成功寫入時間判斷，不受靜止歸零影響。最多 80,000 筆，高速持續每秒保存約可保留 22.2 小時。
- 無新定位不補空白筆數、不重複舊定位；定位本身（elapsedRealtimeNanos）超過 15 秒的丟棄，不早於上一筆已接受定位的也丟棄（duplicate）。原本 3 秒是只用 GPS provider、每秒一筆且都很新鮮時訂的；改用 fused 後，手機靜止、Samsung 停掉 GPS 時，Wi-Fi 定位數秒到數分鐘才來一筆，到達時已約 4.5–5 秒，幾乎全被當過期丟掉（實機一晚 1,004 筆 stale，多段 80–133 分鐘沒有保存任何一筆，被拒定位最舊只有 5.1 秒）。已接受但尚未保存的定位在同一個 15 秒內仍可保存。實際頻率受 Android、接收狀況及省電影響。
- `recorded_at` 是定位本身的時間：以系統時鐘換算（寫入當下的時間減去定位的 monotonic 年齡），不是寫入時間，所以晚到幾秒的定位仍放在正確時間，歷史、今天路線與 PhoneMotion 回放的時間間隔和原生 MotionDetector 一致。新一次記錄的第一筆若是上一次已保存的快取定位（`location_at` 不晚於最新一列、差距 ≤ 15 秒）就略過，不重複寫入；時鐘被往回調超過 15 秒則照常記錄。
- 即時快照的「最後位置已過期」與 motion unknown 同樣以 15 秒為界；地圖藍點動畫與顯示座標仍在 JS 端以 3 秒為界（`PhoneLocationOverlay`），只影響畫面。
- 一直收不到定位時會重新要求一次（`LocationResubscribe`）：開始或上一筆之後 15 秒，之後等 30、60、120 秒，最多每 120 秒一次；收到任何一筆就重算。`am force-stop` 或程序被殺後立刻重開時，Play Services 還在清掉舊程序的要求，新服務的要求可能完全收不到回呼（收到 0 筆，地圖沒有「手機」），重新要求一次就恢復。`dumpsys activity service com.dogtracker/.location.LocationTrackerService` 的 `resubscribed=` 是重新要求的次數。
- 保存空窗診斷（PR 116）：拒收依原因計數（stale／duplicate／invalid／accuracy／jump）。超過 60 秒沒有保存任何一筆時，記下該段的起訖時間、收到／接受筆數、各原因拒收數、最舊過期定位秒數與最佳被拒精度，以及被拒但仍送進 motion 判斷的筆數（`motionOnly`，記憶體最多 300 段）。同樣的次數另存在 App 私有的 SharedPreferences（`phone_location_diagnostics`，最近 30 次記錄、200 段）：每分鐘存一次進行中的計數，程序被系統或使用者結束後，下次開始記錄時把上一次記為「程序結束、以最後一次存檔為準」，進行中的空窗也保留並標示。只含次數與時間，不含任何座標；正式版用 `adb shell dumpsys activity service com.dogtracker/.location.LocationTrackerService` 讀取，會列出本次程序的數字與保存下來的歷史。Samsung One UI 在手機靜止、螢幕關閉且未充電時會由系統停掉 GPS（NSFLP「GPS stop by sensor」），之後只剩 Wi-Fi／基地台定位，這段可能完全沒有合格新定位；這是系統行為，App 不能關閉。
- 新定位必須具有有效、有限、非負的水平估計精度；原始速度 > 20 km/h 時要求 < 50 公尺，其餘情況要求 ≤ 30 公尺；未知或超過門檻時顯示等待提示，不寫入且不推進記錄時間限制（< 50 m 的被拒定位在停留鎖定時仍交給 motion 判斷，見下方靜止判定）。既有資料不刪除。
- 最近 3 個有效樣本平均；速度 > 10 km/h 時，最新點權重為 90%。超過 3 秒的樣本間隔重設平滑視窗。平滑不代表實際精度提高；估計精度仍保留定位來源回報值。
- 即時藍點另有顯示用的小範圍抑制（`src/map/PhoneDisplayPosition.js`）：原始速度 < 1 km/h 且有有效精度時，離上次顯示位置 min(3 m, 精度 / 3) 以內不移動；和保持的位置比，慢慢累積離開範圍就會更新。只影響畫面，不改儲存的座標，也不是靜止判定；歷史重播不再套用。
- 不降低原始定位請求頻率（例如靜止時拉長間隔）：少掉的樣本會改變平滑、靜止判定與解除時間，以及歷史停留的代表位置與起訖，結果無法保持一致。要省電須另做取樣設計，並用回放比對前後結果。
- 即時地圖由 `useLiveLocation` 每秒讀取原生記憶體快照；診斷記錄清單由 `useLocationTracker` 呼叫 `readPage` 讀取 SQLite，每次讀取完成後 10 秒再讀。歷史由 `HistoryDatabase.historyDayRows` 讀取 SQLite 的日期資料，不使用即時記憶體快照。
- `raw_latitude`、`raw_longitude` 保留被保存樣本的原始座標；`session_id` 區分每次記錄。歷史地圖與 GPX 在工作階段切換或超過 3 分鐘間隔時分段。
- `LocationTrackerScreen` 是設定 → 診斷 → 記錄清單的分頁清單；日期／時間範圍與匯出在 `src/mapHistory/HistoryScreen.js`。第三版手機 CSV／GPX 以 recorded route 為主座標，CSV 另保留 raw 欄位；裁切與時間用途見 `../mapHistory/ExportBuilders.md`。每秒樣本僅用於定位管線，不全部存入資料庫。
- `recorded_at` 和 `location_at` 是 Unix 毫秒（`location_at` 是定位來源回報的時間）；緯經度為十進位度；速度由 m/s 轉為 km/h。無精度／海拔／速度／方向時為 NULL。
- 每次寫入與修剪在同一交易，依 recorded_at、id 保留最新 80,000 筆。初始化也修剪舊資料。
- 畫面使用 id 游標每頁 50 筆，前景每 10 秒更新，離開頁面不再輪詢；停止記錄不刪除資料。
- 只存本機、不上傳 Supabase、不修改 dog_status 或 supabase_dog_status。
- 需要精確位置權限與 GPS；不接受只有粗略位置權限。服務只能在 App 前景啟動。系統強制停止／重開機後需再次點開始，不宣稱能永久背景執行。
- iOS 尚未實作；頁面顯示不支援。

靜止判定確認後速度歸零，顯示與儲存座標鎖定於確認當下的平滑位置；原始座標持續保留供移動判定。PhoneMotion 的 JS 歷史回放與 Kotlin 即時記錄維持相同判準：有有效速度精度時，低速證據要求位置精度 ≤ 30 m、速度 ≤ 1 m/s、速度精度 ≤ 1.5 m/s，且速度減誤差 ≤ 0.5 m/s；缺速度精度時只接受位置精度 ≤ 10 m、速度 ≤ 0.3 m/s。至少15秒疑似、20秒確認；高精度樣本另檢查3 m的單向進展，中精度樣本依精度放寬靜止視窗，避免室內小幅飄移冒充離開。

可信速度持續3秒可解除停留。缺速度或錯誤零速不代表走路；須有足夠長、品質合格、持續同方向的幾何進展才能確認移動，高精度以20秒視窗（至少要有 19 秒的定位；不足時往前接上 20 秒前最新的一筆，最多 30 秒前，而且這個接長的視窗過半數定位要量到 0.5–3 m/s，見下段），中精度使用2–10分鐘的有界視窗。離開後的重新停留也保留進展反例，不能一直把真正的慢走鎖回原地。超過30秒沒有連續觀測會重置這個 motion detector 的證據；定位 writer 仍只保存新鮮合格樣本，不補空白筆。失去低速證據超過3分鐘則回到未知。已鎖定的停留遇到 30–50 m 的粗定位（例如系統在手機靜止時停掉 GPS、只剩 Wi-Fi 定位）時，只要該筆速度 ≤ 0.3 m/s（有速度精度時 ≤ 1.5 m/s）且離鎖定錨點不超過 max(25 m, 1.5 × 兩者較大的精度)，就算維持靜止的證據；粗定位本身不能確認新的停留，速度 0.5–1 m/s 的慢走讀數也不能維持，離開這個範圍 3 分鐘、可信速度或幾何進展照常解除。手機定位 writer 仍只保存低速 ≤ 30 m 的定位（見上）；只因精度被拒的新鮮、有效定位，若精度 < 50 m 且 MotionDetector 正鎖定停留，仍交給 MotionDetector 判斷（`LocationPipeline.holdStop`，診斷計為 `motionOnly`，同時照樣計入 accuracy 拒收），但不更新保存候選、不佔寫入時段、永遠不存成一列。上限 50 m 與判準本身的 `valid` 一致：更粗的定位不算證據，只會讓 30 秒重置失效，又讓所在的幾何離開視窗全部跳過。尚未確認停留時不送（粗定位不能確認停留，只會清掉正在累積的證據），所以確認前的行為與只看保存列時相同；同一筆跳點檢查改以上一筆送進判斷的定位為準；不同 provider 倒序送達、比已判斷的粗定位更舊的合格定位照常保存，沿用目前狀態，不讓判斷重置。結果是手機靜止、Samsung 停掉 GPS 只剩 Wi-Fi 定位時，停留不因 30 秒沒有合格定位而重置，GPS 回來時藍點仍在鎖定位置、不跳動；粗定位帶可信速度、離開錨點範圍 3 分鐘或幾何進展仍照常解除，沒有速度的粗定位撐不過 3 分鐘。這使即時判斷與歷史回放在只有粗定位的時段可能不同：PhoneMotion.js 回放只看得到保存的列，那段超過 30 秒沒有列就重置，GPS 回來後要再 20 秒才重新確認；即時這邊則一直是靜止，之後保存的列 `motion_state` 為 stationary、座標為原本鎖定的位置。歷史的停留由回放與同地中斷（`samePlaceBreak`）決定，不看 `motion_state` 的值（只要求欄位存在），所以同一次記錄內的停留仍連成一段；兩邊的判準程式碼不變（parity fixture 照舊）。這些判準是保守啟發式，原始點不改寫，回放及模擬器結果不能代替實際室內／步行真值。

慢走不再被當成停留（2026-10-14）：即時偵測每秒約收到一筆定位，但「我的路線」回放的是存下的列，時速 10 km/h 以下每 5 秒才一列（`LocationPipeline.intervalSeconds`）。最近 20 秒裡只有 3–4 列、跨 15–18 秒，湊不到高精度幾何離開要的 19 秒；3–4 km/h 的狗散步量到的速度是 1.0–1.2 ± 0.7 m/s，扣掉誤差不到 0.5 m/s，不算可信的走路速度；狗停下來聞的 0 速度又讓 3 分鐘的「失去低速證據」一直不到期。結果實機上 4 段、共約 69 分鐘、每分鐘走 30–58 m 的散步，回放時一直鎖在停留點，清單變成 0 m 的編號停留。修正（`PhoneMotion.js` 的 `fineDepartureWidth`／`walkingSpeeds`，Kotlin `MotionDetector.departure` 同一判準，parity fixture 加了 `fine-sparse-*` 三例）：20 秒視窗不到 19 秒時，往前接上 20 秒前最新的一筆（最多 30 秒前；偵測器 30 秒沒有定位就重置），距離（> 2 × 精度）、直線比（≥ 0.85）、單步上限（< 淨位移一半）照舊；但這個接長的視窗過半數定位要量到 0.5–3 m/s。室內同樣 4 m 精度的飄移每筆跑 5–6 m、速度卻是有把握的 0（± 0.1 m/s），不會放開；開車減速時視窗裡多半還是 20–30 km/h 的定位，也不會變成「確認移動」（否則前面整段開車會被回填成確認移動）。每秒一筆的即時偵測本來就有 19 秒，判斷不變。`__tests__/PhoneSlowWalk.test.js` 以桃園車站附近的虛構資料鎖住：3.6 km/h 慢走、同精度的室內飄移、走走停停、開車減速。

歷史另外使用已確認停留的顯示錨點，让停留內的地圖游標與END共點；裁切完全在停留內時可保留不編號的顯示證據。原始訊號缺口、真正的短走與車程不得借用這個錨點掩蓋。手機motion不拿來判定狗項圈在室內。
新欄位 raw_speed_kmh、speed_accuracy_mps、motion_state 保留原始速度、速度估計精度與狀態，包含於 CSV；舊資料為 NULL，不回填推測狀態。速度精度單位為 m/s，速度欄位為 km/h。

`odometer_m`（2026-10-13）：這次記錄（session）從 0 起累積的路程（公尺），由 `LocationPipeline` 在每秒接受的定位之間累加：兩筆都在 moving、誤差都 ≤ 20 m、較新一筆原始速度 ≥ 0.3 m/s、相隔 ≤ 10 秒才加（用平滑後的座標）；每列存當時的累積值。保存每 5 秒一筆的直線會切掉轉角，歷史的「距離怎麼加」在兩點同一 session 都有這欄時改用路程差（見 `src/history/README.md`）。`LocationTrackerStore` 開啟時以 `ALTER TABLE ... ADD COLUMN odometer_m REAL` 補欄；舊列為 NULL，不回填。不在 CSV 欄位內（CSV 照設計規格的欄位）。

驗收：開始記錄後移動或等待新定位，查看筆數和時間；回桌面／鎖屏後等待並返回，確認新增；停止後確認筆數不再增加；關閉 GPS 或拒絕權限確認提示；翻頁期間新資料不造成重複；上限及交易回滾由測試驗證。
