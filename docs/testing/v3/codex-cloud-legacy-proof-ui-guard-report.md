# Legacy 本機紀錄但缺完整性 proof：UI 互斥回歸

基底 2bf9e8522660de8da4aeee159dfe59e57a2c2f2a。新增測試只走 production useHistoryScreen＋HistoryScreen；fixture 只提供獨立虛構的原始本機 rows，沒有 injected model、下載進度或預設取消畫面。先 assert 正常 readDay 的回覆確實有 records，cloud coverageRequired=true 但 durable states=[]。

cancel 與 failure 兩種初始終態，各完整走 loading→terminal→retry→retry failed→retry completed：下載文案為 c1253，保留資料仍不得建立 model/map、匯出 disabled；取消與失敗顯示 unfinished＋retry，不能同時出現 c424 或讀取骨架，也不能冒稱空日／完成。真正 normal UI retry 再顯示下載骨架，直到正常下載完成並提供該 dog/day/cutoff 的 durable coverage proof 才發布路線和開放匯出。取消檢查原 signal aborted 與遲到 rejection 不重啟下載。

RED：暫時只移除 HistoryScreen c424 的 unfinished gate，兩個新增 production UI case 都失敗（2 failed／0 passed）；try/finally 還原 source exact。PASS：還原後 4 focused suites／52 tests 通過，6.443s；changed-file ESLint 0，git diff --check 通過。JSON：/private/tmp/legacy-proof-ui-red-jest.json、/private/tmp/legacy-proof-ui-final-jest.json。初輪測試需按正式 SKELETON_TIMING.delay 推進300ms 才等待預定骨架显示，修正測試計時后无 production bug。

沒有改 production source；沒有 full/build/device／Claude。5554 唯一正式900秒背景 worker照常執行，這些測試不當新 APK native 驗收。
