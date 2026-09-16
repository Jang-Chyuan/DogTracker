# 雲端資料第一版

入口：DogTracker → 設定 → 雲端資料。

1. 使用 Supabase Auth 中已建立並獲授權的 Email／密碼登入。
2. 填台灣日期範圍；Master ID 留空下載所有獲授權 Master，或填 5／7 等編號。
3. 按「下載到手機」。每批最多 500 筆，直到範圍內沒有後續資料。
4. 在下方查看本機紀錄，每頁 50 筆。重新讀取本機資料不使用網路。

## 設定與授權

`CloudConfig.js` 只包含 Project URL 與可公開的 Publishable Key，已從 PC 工具的相應設定移入；不使用 Secret Key、資料庫密碼或裝置 Token。

雲端來源為 `public.dog_telemetry`，不是 `dog_telemetry_taiwan` View。
Supabase 必須啟用 RLS，並允許 authenticated SELECT，使用以下條件授權：

```sql
exists (
  select 1 from public.device_members m
  where m.user_id = (select auth.uid())
    and m.gateway_id = ('master_' || dog_telemetry.master_id::text)
)
```

`telemetry_member_guard` 與 `telemetry_member_read` 均需移除 Slave 篩選；會員表使用 `device_members_read_self`。本模組不修改線上政策，也不提供自行新增授權的功能。

## 本機資料

沿用 `dogtracker.sqlite` 的 `supabase_dog_status`。使用既有共享連線與 Android 原生 SQL 橋接；不開啟第二個 SQLite 引擎。

首次進入登入後的畫面時，會增加 `owner_user_id`、`event_id`、`downloaded_at`、`remote_received_at`，並建立 `(owner_user_id, event_id)` 唯一索引。沒有帳號歸屬的舊資料不會顯示。每個帳號只顯示自己的快取。

GPS、速度、HDOP、活動值依韌體比例換算。`received_at` 存 Unix 毫秒；分頁使用原始雲端時間及 UUID，保留微秒精度。`raw_payload` 保存整筆雲端 JSON。Slave GPS／活動時間保留原始值，未推定時間基準。

## 第一版範圍

- Session 只存在記憶體；不保存密碼或登入 Token。重啟 App 需重新登入，之後可查看先前下載資料。
- 手動下載採固定日期範圍與當次操作時間上限；不是即時訂閱或持久同步游標。
- 假設雲端事件為追加且不可變；相同事件重複下載不新增，不更新已下載事件，也不同步刪除。
- 取消／失敗保留已提交批次；可再次下載相同範圍去重補齊。離開雲端頁會取消下載。
- 登出隱藏本機快取；帳號切換隔離顯示。雲端撤銷 Master 授權不會自動刪除以前合法下載的離線資料。
- 本機表格目前提供常用解析欄位，不將雲端資料接入 BLE 地圖。

## 驗證

```powershell
npm.cmd test -- --runInBand __tests__/Cloud.test.js __tests__/CloudScreen.test.js
```

實機驗收：已授權帳號讀取對應 Master 全部 Slave；無授權帳號下載為空；相同範圍下載兩次筆數不增加；斷網後重新讀取本機資料；取消後重試；登出與換帳號不顯示前一帳號資料。

目前兩個已知帳號皆有 Master 5／7 授權，需另外使用無授權帳號驗證拒絕讀取。不能以 postgres 或 Secret Key 測試使用者 RLS。
