# AI 協作規則

給 Claude、Codex、Gemini 等 AI 代理與人類協作者。開始前先讀：

- [PROJECT_GUIDE.md](PROJECT_GUIDE.md)：模組分工、BLE 協定、開發、測試與 Git 協作流程。
- [DESIGN.md](DESIGN.md)：改畫面前必讀；和它衝突的改動要先提出來。

## 驗證截圖與實機資料

這是公開 repo，任何人都看得到 commit 進來的檔案與完整歷史。

- 不要把驗證截圖、錄影或實機資料 commit 進 `main` 或任何功能分支，包括 PR 前後對照圖、GIF／MP4、uiautomator XML dump、`adb` 輸出、裝置資訊、APK 與資料庫快照；也不要放進 `docs/`、`artifacts/` 或其他目錄。
- PR 說明要附的截圖，只能推到 `claude/screenshots` 分支（PR 說明的圖床，不要刪除，也不要 force push）：
  - 每個 PR 一個資料夾 `pr-<編號>/`，例如 `pr-139/labels-after.png`。
  - 只用小張 PNG，先裁切、壓縮到只剩要看的部分；除非真的必要，不要放影片。
  - PR 說明用完整 40 字元的 commit SHA 連結：`https://raw.githubusercontent.com/Jang-Chyuan/DogTracker/<完整 commit SHA>/pr-<編號>/<檔名>.png`，不要用分支名稱，之後分支內容變動也不會讓舊連結失效。
- 任何截圖只能用虛構資料，不得含真實位置、地址、軌跡、帳號、狗名或裝置序號。
- `.gitignore` 已排除 `artifacts/`、`docs/verification/`、`docs/testing/pr-*/`、`docs/testing/assets/` 與影片檔；不要用 `git add -f` 繞過。
- 驗證過程的文字摘要（測了什麼、結果如何）寫在 PR 說明；只有描述產品行為、之後仍有用的文件才放進 `docs/`。
- 與產品無關的獨立專案或實驗程式不要放進這個 repo。

## 修錯流程

1. **先重現**：在動程式之前，先做出一個會失敗的重現——jest 測試優先；只有模擬器或實機才看得到的，寫下固定的情境（畫面情境名稱或步驟）和量到的數字。重現不出來就先回報「重現不出來」與試過的條件，不要憑猜測修改。
2. **再找原因**：說明為什麼會發生（哪一段程式、什麼時序或資料），寫進 PR 的「原因」。只修症狀、原因不明時，PR 要寫清楚是預防性修正。
3. **修正**：只改造成問題的地方，不順手重構不相關的程式。
4. **同一個重現要通過**：第 1 步的測試在修正前失敗、修正後通過（PR 寫明）；模擬器或實機的情境用同樣的步驟重跑，附前後數字或截圖。歷史判定相關的修正，另外用使用者的真實紀錄重算前後（只回報時間與數字）。
5. **檢查對應的另一條路**：狗和我的路線（以及即時地圖和歷史）常有平行的實作（讀取、快取、輪詢、判定、匯出）。修效能或修錯時，同時檢查另一條路有沒有同樣的問題：有就一起修，或另開 PR 並在本 PR 寫明；沒有就在 PR 寫明為什麼不用（例：狗沒有這段程式）。
6. 測試、lint、CI 都過了才開 PR／標成 ready。

## 跨模組改動先審設計

改動會碰到下列任一項時，**實作前**先在 PR（或 draft PR）寫一段設計，請另一個代理（例如 Codex）審過再動手：

- 資料庫的鎖、交易、WAL、讀取通道或保留／修剪（`DogStatusStore`、`LocationTrackerStore`、`LocalRetention`、`CloudStaging`）。
- 雲端同步、背景工作與前後景切換（`IndependentCloudSync`、`CloudBackgroundSync`、`useTrackingSession`）。
- 歷史判定的核心規則（停留、出發、移動、距離、缺口；`src/history/`、`src/placement/`）。
- 原生服務的生命週期（`BleForegroundService`、`LocationTrackerService`、更新／重開機恢復）。
- 一次改動跨兩個以上上述模組，或改到 BLE 協定、資料表結構。

設計要寫：要解決什麼、改哪些檔案與介面、資料或時序上的影響（舊資料、升級、並行）、怎麼驗證、哪些情況可能變差。審查意見與決定一起留在 PR 說明。
