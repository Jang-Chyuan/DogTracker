# AI 協作規則

給 Claude、Codex、Gemini 等 AI 代理與人類協作者。開始前先讀：

- [PROJECT_GUIDE.md](PROJECT_GUIDE.md)：模組分工、BLE 協定、開發、測試與 Git 協作流程。
- [DESIGN.md](DESIGN.md)：改畫面前必讀；和它衝突的改動要先提出來。

## 驗證截圖與實機資料

這是公開 repo，任何人都看得到 commit 進來的檔案與完整歷史。

- 不要把驗證截圖、錄影或實機資料 commit 進 repo，包括 PR 前後對照圖、GIF／MP4、uiautomator XML dump、`adb` 輸出、裝置資訊、APK 與資料庫快照。
- 需要給人看的圖放在 PR 說明或留言（GitHub 附件），不要放進 `docs/`、`artifacts/` 或其他目錄。
- PR 說明或留言裡的圖，優先直接拖進 GitHub 編輯框上傳成附件（`user-attachments` 網址），不會因分支刪除或檔案移除而失效。
- 若一定要連到 repo 內的檔案，網址要用完整 40 字元的 commit SHA（例如 `raw.githubusercontent.com/Jang-Chyuan/DogTracker/<SHA>/路徑`），不要用分支名稱；分支被刪除或之後移除檔案時，分支名稱的連結會變成 404。
- `claude/screenshots` 分支是舊 PR 說明的圖床，不要刪除，也不要再往裡面加新圖。
- 任何截圖只能用虛構資料，不得含真實位置、地址、軌跡、帳號、狗名或裝置序號。
- `.gitignore` 已排除 `artifacts/`、`docs/verification/`、`docs/testing/pr-*/`、`docs/testing/assets/` 與影片檔；不要用 `git add -f` 繞過。
- 驗證過程的文字摘要（測了什麼、結果如何）寫在 PR 說明；只有描述產品行為、之後仍有用的文件才放進 `docs/`。
- 與產品無關的獨立專案或實驗程式不要放進這個 repo。
