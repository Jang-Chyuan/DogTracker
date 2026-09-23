# 手機 BLE 轉送 Supabase（第一版）

Android 收到 BLE 原始 JSON → SQLite 待傳佇列 → 已登入且 App 在前景時，每 10 秒送出最多 20 筆 → 同一個 Supabase `dog_telemetry`。

背景 BLE 服務仍可收件、寫入待傳佇列；本版網路上傳於回到前景後進行。沒有自動切換 Wi-Fi、故障備援或回補既有歷史資料。

## 部署順序

1. 在原本存放 `dog_telemetry`、`device_members` 的 Supabase 專案 SQL Editor 執行 `supabase/migrations/202609220001_phone_upload.sql`。先備份並確認原表存在。預設 Master 5、7 保持 Wi-Fi。
2. 部署 `supabase/functions/ingest-phone-telemetry/index.ts` 為 `ingest-phone-telemetry`。使用 CLI 時執行 `supabase functions deploy ingest-phone-telemetry --project-ref uhfrfawcktrhfoqyhutg`，保留 JWT 驗證。函式使用伺服器端 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`；不可把 service-role key 放進 App。
3. 手機登入已有 `device_members` 授權的帳號。設定 → BLE 雲端轉送設定，複製顯示的手機 ID。授權仍以 `gateway_id = master_7` 等 Master 為範圍，涵蓋其所有 Slave。
4. 將指定 Master 的韌體 `SUPABASE_ENABLED` 設為 `0` 並重新燒錄，保持 BLE 啟用。App 的選项不能改變韌體 Wi-Fi 開關。
5. 管理員在 SQL Editor 指定唯一轉送手機（替換以下 UUID 和 Master 編號）：

```sql
insert into public.master_upload_routes(master_id,mode,owner_user_id,phone_id)
values (7,'phone','使用者的 UUID','設定頁顯示的手機 UUID')
on conflict(master_id) do update set mode=excluded.mode,
  owner_user_id=excluded.owner_user_id, phone_id=excluded.phone_id;
```

6. App 對應 Master 選「本手機 BLE」，連接該 Master。保持 App 前景，確認待傳數下降及最後成功時間更新。
7. 驗證雲端 `dog_telemetry` 的 `upload_source = phone`、`uploaded_by`、`phone_id`、Master／Slave、座標及原始 GPS 時間；將 App 切背景接收幾筆，再回前景確認補送。

雲端 trigger 會拒絕 phone 模式 Master 的既有 Wi-Fi 入口寫入，也會拒絕非指定帳號／手機的轉送。手機 ID 是軟體安裝識別，不是硬體證明；重裝或清除資料後需重新綁定。

## 資料與重送

- 保留 BLE 原始資料；上傳時還原 LoRa 欄位單位，不使用地圖平滑座標。
- 手機每筆入列產生 UUID，所有重送沿用同一 UUID。雲端同 UUID、同內容視為成功，不同內容回報衝突。Wi-Fi 與手機不做跨路徑事件去重。
- 同一帳號／Master、60 秒內完全相同的 BLE JSON 不重複入列；不同序號仍是不同資料。
- 佇列與帳號綁定，登出不再新增，其他帳號不能送出原帳號資料。
- 網路或伺服器暫時錯誤採退避重試；格式／授權錯誤標為阻擋，修正後按重試。
- 待傳與阻擋資料合計上限 20,000 筆；滿時停止新增上傳佇列並顯示錯誤，不刪除既有待傳資料。成功資料保留最新 1,000 筆。
- `received_at` 保留雲端入庫時間，供增量下載游標、核對與資料清單使用。歷史軌跡另存 `track_at`：手機來源使用有效的 `phone_received_at`，Wi-Fi 或缺少有效手機時間的資料沿用 `received_at`。查詢區間、日期清單、平滑、回放及 CSV／GPX 都使用同一個軌跡時間。
- 舊版未下載手機時間欄位。更新後每輪自動同步會額外補查最多 200 筆既有事件的時間資訊，優先處理最近入庫資料；需保持登入及可連線，分批完成。修復前暫用原入庫時間，修復後清除受影響 Master／Slave 的平滑快取並在查詢時重算。原始座標、原始 JSON 與下載游標不因修復而覆寫；既有資料保留期限政策照常執行。

## 切回 Wi-Fi

先在前景清空待傳佇列，再將 App 對應 Master 切回 Wi-Fi。管理員更新雲端，最後啟用韌體 Wi-Fi 上傳：

```sql
update public.master_upload_routes
set mode='wifi', owner_user_id=null, phone_id=null where master_id=7;
```

本機切換只暫停佇列，不刪除待傳資料，也不會自動修改雲端綁定。未完成的舊佇列需由管理員確認處理方式。

## 驗證範圍

本機已包含 SQLite 佇列、欄位換算、帳號隔離、重送 UUID、權限失敗及並行防護測試。Release 建置可驗證 Android 原生收件程式能編譯。SQL 與 Edge Function 必須部署至目標專案後，依上述流程另做實機端到端驗證；本機測試不代表雲端已部署。
