# 歷史清單改版驗證

產品候選24e0e740（主分支整合e876a785），基於已核准main274759f2。移除畫面「我的路線」、座標與停留結束小字；步行及車程圖示在左線中央，停留膠囊放在地址前，支援長地址／大字換行。相鄰步行僅呈現合列，保留真停留、缺口與開車邊界；GPS弱不單獨列出。PNG時間軸同步，CSV／GPX與模型資料不改。

範圍重算先進載入状态，暫停顯示舊結果與匯出；較晚只處理最新要求，換日／返回／帳號切換取消舊要求。來源與hook反例通過，首版真範圍影片已看到載入首幀，但載入期間仍見殘留線；source發現拖曳尚未結束就多次發布preview的路徑，已改為手勢期間持續載入、把手即時移動，放開後才算最後範圍。真正hook反例及兩種畫面layout皆驗；新版普通字體原生影片已錄製，證明長手勢保持載入／把手移動，放開後更新一次；初始及完成／返回的原生畫面接界仍有載入與線共存，不宣稱全部pending畫面空白，也不能以32ms排程或這段影片當作CPU／100ms驗收。

## 驗證

- 主視窗最新完整223套／2503項測試通過，164.077秒。首輪舊UI及同步範圍契約失敗已保留紀錄，修正契約後重新全測。
- 已建置原生Release產品與相同來源的隔離展示版；展示版只在私人分支，未納入PR。最新拖曳展示APK SHA baf643ebbb139999d56b746855e5265a96001014dcfa981c833993a1f5460100，Release19秒實際成功。
- 私有10/10實際5067筆回放，15:25–15:43原六段相鄰步行變一列；模型、CSV、GPX、PNG地圖逐一相同。不公開使用者原始位置、CSV或實際路線。
- 下圖完全獨立虛構240筆桃園場景。改版前三段步行（4／5／3分鐘）合為一列11分鐘，保留三個算法停留及3分鐘車程。算法停留不是人類真值。
- 改版前冷啟動曾出現原生ANR，按一次系統Wait後恢復，才拍正常比較圖；原失敗圖與紀錄私人保留。該問題沒有因截圖恢復就被算作已修復。新版普通字體拖曳及返回已有實際證據；大字末列仍未通過。

## 前後畫面

| 改版前 | 改版後 |
| --- | --- |
| ![改版前三段相鄰步行](evidence/history-timeline-compact/before-top.png) | ![新版合列及同行膠囊](evidence/history-timeline-compact/after-top.png) |

![改版前車程與第二停留](evidence/history-timeline-compact/before-mid.png)
![改版前最後停留與結束列](evidence/history-timeline-compact/before-end.png)

本PR未合併；使用者看圖與操作證據後才決定。

## 大字體與裝置狀態界線

5558 fontScale2原生畫面證明長地址及前置膠囊可換行；末列驗收被System UI ANR阻擋，未列通過。字體、設定、授權及正式164已還原，既有5558重開一次仍有系統ANR，不能稱正常live閉環通過。既有5562已正常啟動及讀回原163設定，接續用相同虛構資料驗新拖曳；未建立新AVD，未清資料。


## 最新普通字體原生證據

最新after-top及下方新圖／原影片來自既有5562，產品24e0e740＋私人展示8bdcda6b，APK SHA為上列baf643…，installed SHA與單一App PID在操作前均實核。展示四個runtime檔案和前一私人展示e70f逐byte相同，沒有匯入真CSV或原路線形狀。Private展示來源不在此PR。

既有三張before-top/mid/end仍來自5558的舊版基準APK7ec2e889…；先前after-top曾來自同台首版UI APKb16b1c0c…，這次換成最新baf643…原圖。這是相同獨立虛構資料的UI對照，**跨裝置，不能當效能A/B**。公開PNG是原screencap或原影片直接解碼frame，沒有裁切、拼接、修線或合成。manifest提供各檔SHA。

![拖曳中：本地把手已移動，模型仍在載入](evidence/history-timeline-compact/after-range-pending.png)
![放開後：最新09:03範圍，匯出恢復](evidence/history-timeline-compact/after-range-final.png)
![下一手勢中返回：保留已完成09:03範圍，控制列关闭](evidence/history-timeline-compact/after-range-back.png)

[原生普通字體拖曳與返回影片](evidence/history-timeline-compact/after-held-range.mp4)

錄影指令15秒，原檔8.8383秒／112個原生frame；後段畫面靜止沒有新增frame，沒有補幀或偽填時長。第一手勢3500ms向右移動，local把手08:50逐步到09:03，長held主段維持讀取中，清單不重現且map route被清除。放開後只出現09:03結果、匯出恢復；第二手勢的local把手到09:05時按Back，未完成的範圍被取消，最後清單及摘要仍是09:03，沒有其後09:05結果回填或重新開把手。最後XML確認無loader、export enabled／clickable、rangebar不存在且無ANR。

**界線仍保留：**初始busy、放開及Back的相鄰原生frame存在spinner與route短共存；影片不能證明所有pending原生畫面同時空白，也不能單憑這點歸因Google SDK。沒有觀察到手勢中途新清單或錯誤範圍發布；它不等於對所有資料或nativepaint作普遍保證。只有一個240筆功能場景，沒有CPU、100ms點線或真資料吞吐驗收。主視窗已親看完整112 frame／PTS的四張私人QA contact及原PNG，確認09:05取消未發布；以上原生接界及大字失敗限制仍保留，不標為全原生ready。

5562原本Supabase未登入，recording開關ON但定位權限未允許；這些原狀保存，沒有為測試新增permission。此次未改字體／主題／無線／viewport、未清DB/auth/cache、未新建AVD。5558及fontScale2的System UI ANR限制仍如上，不因這次普通字體成功而刪除。


## 測後恢復

既有5562已保資料還原原版0.3.163，installed APK SHA640463a5e8ff5955830e2106d3fb97d790ebd6322b24cb395ad36262238f51fa逐一核對。九項原設定（含fontScale1.0、主題、無線）、viewport與六項permission grants／flags均和測前完全一致。實際設定頁仍Supabase未登入、位置紀錄開關ON且定位權限未允許；返回正常live地圖，XML及原PNG均無ANR，單一App PID5563。沒有清資料／快取、沒有改帳號或AVD；原版恢復圖只在私人驗收目錄，不混入改版公開證據。
