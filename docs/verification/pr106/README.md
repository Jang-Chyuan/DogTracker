# 犬頭像與卡片身分驗證

這兩張原生截圖來自既有 5562、私有純記憶體 QA 版本 0ac6fac1，使用既有 all-good 虛構位置、狗名與活動資料；沒有登入、匯入或查詢真實帳號資料。兩個 marker 元件檔案與此 PR 的 c9de9ac6 完全相同；QA 另外包含 PR101 與 fixture 選單，並非独立 PR106 正式 APK。

- separated-faces.png：狗頭像與獨立名稱標籤。
- dog6-card.png：實際點虛構「小黑」頭像後，卡片顯示「小黑／訊號源 6」。

這是該次正常地圖點擊與畫面的證據，不代表所有密集重疊情境均已通過。60dp 鄰近頭像邊界、重複事件及 Android／iOS 座標換算另有來源測試；正式整合 9d 在 5558 的真地圖曾驗證狗6頭像與名稱均開啟狗6。


## Native export acceptance, 2026-10-11

export-options.png and gpx-repeat-download.png are actual emulator5562 UI captures from private QA2fdcfbad based on product33b6a7e4 plus the isolated memory-export adapter. png-page-1.png/png-page-2.png are the actual native exported files, not source renders or image composites. The86points are independently generated from nine invented stationary coordinates connected by eight120m straight walks; no actual user CSV, shifted geometry, real account or raw data is used. Root reviewed every image before publication. Google map attribution is retained.

GPX repeats use plain.gpx and suffix-before-extension(1).gpx,10284bytes each/86trkpt/8waypoints/1segment; CSV repeats21981bytes each/86rows/24columns; both duplicate files match whole bytes and cross-format raw coordinates/timestamps match pointwise. Export options preserve the existing top-right header control. Native PNG2pages,1080x2350 and1080x1702,footers1/2 and2/2 checked visually. Independent formula rows exercise IO/layout and do not establish GPS accuracy or real field movement.

Private QA activation and extra fixture code are not part of this PR or any formal APK. Google Photos external-view closure is documented separately after actual completion; these raw PNG artifacts alone do not prove external App opening.
