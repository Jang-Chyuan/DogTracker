# 下載狀態畫面

既有5562，Android release。正式source9d3301ad加私有QA fixture開關（b5ef21e1）；圖為原始pixels。完全虛構的桃園資料，無真人帳號、位置、原始CSV或匿名整段路線形狀。

- initial-download.png：synthetic初次下載，lastSuccess=null，地圖顯更新提示。
- update-failed.png：synthetic失敗，顯更新失敗與重試。
- retrying.png：synthetic重試，提示更新並讓舊狗半透明。

這三張只驗UI狀態，不能視為真Supabase網路/故障測試。5554登入帳號的實際驗證另記私有測試報告。最新位置優先與背景歷史補下載為後續同PR實作，完成後再補其實際流程圖。
