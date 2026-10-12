# 068 大型資料原生 CPU：追蹤計畫

狀態：Draft，尚未完成。只記錄驗證工作，不新增產品優化或私有 observer。PR [114](https://github.com/Jang-Chyuan/DogTracker/pull/114) 處理雲端初始化／最新位置；PR [115](https://github.com/Jang-Chyuan/DogTracker/pull/115) 處理範圍操作 UI。wall latency、host SQLite／Node 成本與原生 CPU 分開驗收。

## 目前證據與失敗保留

既有來源成本／語意 parity、少量正常資料操作，不等於大型原生 A/B 通過。20k 私有模型測窗曾 MODEL／MAP 未完整閉合、缺完整指紋，仍為 FAIL；延長測窗或換 4k 不改寫原失敗。4k 已有前後來源、相同 observer 與完整工作量指紋，但尚無有效原生配對結果。

原 two-recording-ON admission 因接收器未設定而拒絕。另有明確的「手機記錄 ON＋接收器未設定」純模型 protocol；曾暖機後因外部主機工作繁忙未量測，已還原正式 APK。它不能代表 BLE／接收器、20k 或正式 idle 全情境。

## 待辦與受控實驗

- [ ] 凍結前後兩份來源；除目標效能變更外 observer、輸入、scope/range/cutoff、模型與地圖輸出指紋一致。
- [ ] 真編譯 APK admission：完整 SHA、簽章、native version 與實際 source count 分列；正常 install-r，不降級、清資料或卸載。
- [ ] 保存原帳號、記錄狀態、權限 flags、設定存在性、網路與 viewport；scope 名稱如實反映可見狀態，不假傳 twoON。
- [ ] 同裝置 fresh PID、至少 300 秒正常暖機；取得真 quiet window，保留不可控制主機負載。不得停止其他使用者工作。
- [ ] 先 45 秒正常 idle，再唯一冷模型測窗；暖機不預先建模型，不把 cached 當 cold。Perfetto 配合實際 JS tid、完整 MODEL/STOPS/MAP phase、scheduler time 與 trace loss admission。
- [ ] 首輪 A→B 完成後評估噪音；需要時反序 B→A。以成對相同指紋／完整 phase／同 scope 比較，不把單輪 wall 或 gfxinfo 當 JS／GL 因果。
- [ ] 4k 先驗工具與可達性；20k 另取得完整閉合原生結果，若仍失敗先定位，不無限重送 URL／重建 APK。
- [ ] 驗真長資料範圍拖曳／路線點擊：input 至游標首次更新與跟手影像，地圖 GL 不能只用 UI 幀率替代；<100ms 門檻缺證据就未驗。
- [ ] 每輪有限 workers 閉場、正式 APK 還原、帳號／記錄／設定精確閉環；只公開匿名數字及合成場景。

## 完成條件

- [ ] 受控原生配對有完整 trace、phase、指紋與有效性判定，能區分 CPU、等待、冷建模與 cached 成本。
- [ ] 大型 20k 的原失敗被保留並有獨立重驗結果；不以 4k 或 host 改善替代。
- [ ] 正常記錄、ride/alerts、定位 freshness、相機／日期／範圍語意保持；若有修正，反例與正式互動通過。
- [ ] 未達門檻／無 quiet／不可達 scope 明列，使用者看過報告並明確允許才 merge。
