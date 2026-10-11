# 最新狗位置：有界預取

原本的 `downloadCloudLatest` 只有兩個 dog jobs；第三隻狗等待空位時，完整狗名單的 seek discovery 也停止。本次讓同一個 discovery cursor 與兩個 workers 分開，FIFO 最多保留四個已發現、尚未開工的 keys。佇列滿才等待 worker；沒有限制整體狗數，也沒有換成會員表的 Slave 名單或最近一頁遙測。

每個 worker 仍同時查 phone／fallback 兩種時鐘；最新 packet 沒有有效定位時，才查獨立 valid-fix 的兩種時鐘。最高仍是一個 discovery request 加四個 dog requests。輸出保持完整 discovery 順序，只有 discovery 結束且所有佇列／workers 排空後才回傳；發布端的原子提交不變。

所有請求沿用 owner／generation guard 與共享 cancellation fence。任一 discovery、packet、fix 失敗都拒絕整批 snapshot、取消其他請求並停止佇列補位。即使某個 transport 忽略 AbortSignal，邏輯取消仍可先完成；遲到結果不能啟動下一隻狗或回傳 snapshot。

驗證使用獨立人工資料和 deferred transport gates：

- 兩個 workers 卡住時可先發現四個待處理 keys；佇列滿不再發 discovery，workers 釋放後繼續枚舉全部十隻狗。
- dog／owner／signal 失敗可解除滿佇列等待，且遲到結果不再派工。
- discovery transport 忽略取消並保持 unresolved 時，另一 dog 失敗仍能拒絕整批。
- 原有雙時鐘、微秒排序、安靜狗、無定位 packet／獨立舊 fix、SDK query filters、重複 keys 與獨立 serial oracle 比對仍保留。

Focused 結果：`CloudLatest`、`CloudLatestSync`、`CloudLatestContext`、`CloudLatestInitializeOverlap`、`CloudLatestSnapshot` 五套共 67 tests 全數通過；變更的 JS 檔 lint 無錯誤／警告。同一個滿佇列行為測試換回 root258 原始 source 時確實失敗：原版只能發到 `key:2`，尚不能預取 `key:3–5`；還原修正版後 source 內容維持原樣。

這些是正確性與排程界線的 source tests，不是 HTTP 或 Android 效能數字。實際 cold／resume 延遲改善需在同一帳號、裝置及資料下另外量測；沒有修改遠端 schema／索引，也沒有改成部分位置先假裝完成。
