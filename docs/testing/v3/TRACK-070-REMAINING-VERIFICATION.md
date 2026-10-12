# 070 操作與雲端特殊情境：追蹤計畫

狀態：Draft，仍有未覆蓋項目。這份計畫不把所有舊待辦重新列為未做，也不把 source fixture 當真平台驗收。雲端修正歸 PR [114](https://github.com/Jang-Chyuan/DogTracker/pull/114)，歷史樣式歸 [115](https://github.com/Jang-Chyuan/DogTracker/pull/115)，密集狗身份選取歸 [113](https://github.com/Jang-Chyuan/DogTracker/pull/113)。

## 已有版本限定證據

正常頭像 picker/editor/crop 的部分取消與成功路徑、通知已拒絕後設定返回、同 PID light→dark→light、減少動態的普通冷啟動、兩頁 PNG 分享 chooser→取消→再產圖，以及部分 CSV／GPX／PNG 重名存檔已有原生證據。保留 exact 版本與原覆蓋範圍，不為維持忙碌重跑，也不延伸為所有 OEM／permission／storage 情境通過。

## 待驗清單

- [ ] 最新正式候選做必要操作回歸與設定閉環，根據實際變更選情境；錄製／登入／已保存資料保留。
- [ ] TalkBack 真 focus／activate／Back／focus-return／可取得語音：先辨識系統服務與 overlay。既有 Suite 權限 overlay 擋住 App，underlay XML 不是成功；不盲 Tab/Enter，不私自授權服務。
- [ ] 原生首次權限 Deny／Retry／設定返回：已有拒絕設定返回不能當首次 prompt；無可安全原始狀態就維持未驗，不清 asked flags 假新裝。
- [ ] 真雲端首次無快取登入、撤權／token 失效與恢復：需獨立可用 QA 帳號及明確授權。沒有帳號不能清真帳號快取、改 token／membership 或關閉此項。
- [ ] 真多頁下載期間點狗／切日／取消／重試，失敗一狗不誤標全部完成；以真遠端資料可達狀態驗證，不 DB seed 宣真 PASS。
- [ ] 下載／補資料中 HOME→resume、立即進我的路線、狗歷史 loading、失敗後重試、程序重開；真同 attempt consumer ACK／新 attempt proof 與畫面配對，不只 latest-published producer log。
- [ ] 真原生已開始維護 TX 的 resume 爭用：不能人工 98 秒鎖宣自然情境，不把普通 2–6 秒冷啟動替代；與 114 明列責任及剩餘證據。
- [ ] 實體接收器連斷線、BLE、Wi-Fi 讀寫／切換／真上傳與 OEM 背景電池／鎖屏，需要硬體。模擬器只能驗 UI，不驗 radio／firmware。
- [ ] API24–28 真 SAF、GPX 外部 viewer/import、可安全製造的原生 storage failure／rollback；平台或安全条件不足保持未驗，不塞滿使用者磁碟。
- [ ] 無 QA／硬體／平台的項目登記需要的前提、優先度與下一個有限步驟，不能因不可達就標完成或結案。

## 證據與完成條件

每個項目需 exact source/APK SHA、實際 UI／系統行為、有限起訖、已覆蓋與未覆蓋、設定／grants／帳號／記錄閉環；私有畫面不公開。從既有模擬器選用並先交接唯一控制權，不建新 AVD。

- [ ] 所有可安全達成項目有正式候選版本的必要驗收；缺陷有修正或明確保留。
- [ ] 外部情境取得前提後完成，或使用者明確接受其仍未覆蓋；沒有 QA 帳號不自動關閉。
- [ ] 匿名矩陣經使用者審閱，明確允許才 merge；不把文件 checklist 當產品已完成。
