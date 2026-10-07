# 畫面情境（只在 debug 版）

模擬器做不到的狀態（接收器連線中／斷線、雲端資料、狗停在室內、舊位置…）用「畫面情境」打開，再截圖比對設計稿。情境只換掉畫面本來就收的**輸入**，畫的是真的畫面。

```
dogtracker://dev/fixture?name=<名稱>    打開情境
dogtracker://dev/fixture?name=off       回到真實資料
```

- 只有 `__DEV__` 會監聽（`useScreenFixture.js`），只有 `android/app/src/debug/AndroidManifest.xml` 宣告 `dogtracker` scheme；release 版收不到這個連結。
- 情境開著時，真實的 SQLite／BLE／雲端照常在背景跑，只是地圖不讀它們（雲端讀取暫停）；情境不寫入任何資料。

## 情境換掉哪些輸入

| 輸入 | 情境裡寫什麼 | 經過哪段真的程式 |
| --- | --- | --- |
| 接收器狀態 | `BleBackground.getState()` 的回傳值（含 `expectedMasterId`） | `useReceiverState` → `ReceiverState.js`（`receiverLink`、`receiverNumber`、`isOtherReceiver`） |
| 本機 BLE 列 | `dog_status` 的列（含 `satellites`、`hdop`、`usb_present`、`rssi`、`master_lat/lon`） | `mapDogStatusRow`、`mergePositionSamples` → `tracking.point`／`positionSamples` |
| 雲端列 | `supabase_dog_status` 的列 | 模仿 `CloudDatabase.latestBySlave`／`latestStatusRows`（含環境模型）→ `cloudDogs.rows`／`packets` |
| 停在原處、接收範圍 | **給列，不直接給 hold 或判定**：本機＋雲端列照 `holdRows` 冷啟動的方式交給真的 `HoldStore`／`IndoorHold`＋內建環境模型算出 `holds`、`statuses`；同一批列也算出每隻狗的接收範圍判定 `ranges`（`ReceiverRange.js`） | `mergeDogMarkers`、`outOfRangeLines` |
| 雲端同步狀態 | `useCloudSync` 的 `ownerId`、`lastSuccess`、`lastDownloadAt`、`failingSince`、`error` | 地圖收到的 `cloudSync`；雲端狗的「沒有新位置」照 `DogFreshness` 用 `lastDownloadAt` 判斷 |
| 手機位置／路線 | 現在位置（`useLiveLocation` 的樣子）和最近 10 分鐘的路線 | 地圖上的手機點；路線交給真的 `RideAlong` 判斷坐車 |
| 手機記錄、權限 | `phone.recording: false` 讓記錄服務沒在跑；`phone.permission`／`phone.services` 是 `usePhoneLocation` 的回答（預設精確位置、定位服務開著） | `todayPill`（右下「今天 x km」的 icon）、`phone.enabled`（地圖藍點） |
| 今天的路線 | `phone.today`：今天 `myLocationTracker` 的列（每 10 秒一筆） | 和 `useTodayRoute` 同一套 `addRoutePoints` 算出「今天 x km」 |
| 狗的名字 | `dogAliases`（4 豆豆、6 小黑、8 阿福） | 名稱牌、卡片、個人頁（A5） |
| 狗的頭像 | `avatars`（訊號源編號 → 頭像；沒給就是預設插圖）；`src/dev/fixturePhoto.js` 是腳本畫的假照片 | 地圖標記、卡片、個人頁 |
| 時鐘 | 固定 `FIXTURE_NOW` = 2026-10-07 09:30（台灣） | 地圖的 `now`（取代 `useMapClock`） |
| 打開的卡片 | `openDog`（訊號源編號）；`openPage: 'edit'` 再打開牠的個人頁（A5） | `MapScreen` 開那隻狗的摘要卡片（A3） |
| 卡片的讀數 | 同一批列的 `activity`／`activity_valid`／`battery_valid`，`readCardRows` 照 `CloudDatabase.dogCardRows` 的查法交出 | `DogCardReadings`（活動量每分鐘、最新有效電量）→ `DogCardModel` |

第三版沒有隱藏的狗、跟隨；情境裡卡片的「看軌跡」不會寫進這支手機的歷史查詢。在情境裡的個人頁（A5）改名字、換頭像只記在記憶體（`useFixtureEdits`），畫面照樣更新，換情境或關掉就忘記，不會寫進這支手機的狗名和 `dog_avatars`。所有座標都是桃園車站附近捏造的位置，不要用真實資料的區域。

## 現有情境

| 名稱 | 狀態 |
| --- | --- |
| `all-good` | 接收器 7 收資料中、雲端同步正常、三隻狗都是新的、手機記錄中 |
| `no-data` | 沒設定接收器、雲端沒有資料（已登入）、沒有任何狗 |
| `signed-out-map` | 沒登入（「稍後再說」）：只有接收器 7 收到的豆豆、狗 5；手機裡之前帳號下載的雲端列（小黑、阿福）不畫 |
| `receiver-connecting` | 接收器 7 剛選好還沒收到資料；最新一筆封包來自之前用的接收器 3，不能當成 7 畫 |
| `receiver-disconnected` | 接收器 7 五分鐘前斷線、自動重連中；牠收的豆豆不再更新 |
| `dog-indoor` | 小黑進室內 12 分鐘：先有清楚定位，之後封包沒定位 → 真的 hold 規則判「室內」 |
| `dogs-aged` | 豆豆最新、小黑 4 分鐘前（還算新）、阿福 40 分鐘前（灰色頭像＋紅色「!」＋放大） |
| `range-out` | 豆豆從接收器 7 走到 1.6 公里外：不在接收範圍，從範圍圈邊緣拉紅色虛線 |
| `range-near-edge` | 豆豆在 880 m（快離開，800 m–1 km）：圈內、不畫線，卡片才變琥珀（046） |
| `range-returning` | 豆豆出去 1.3 公里後走回 950 m：還沒解除（要 900 m 內 2 筆、跨 2 分鐘），仍是圈外，但畫在圈內所以不畫線 |
| `range-stale-inside` | 小黑快 3 分鐘沒有新位置，最後一筆時在範圍內（780 m）；之後接收器往反方向走 300 m，那個位置現在落在圈外 → 判定停在最後一筆，不畫線 |
| `dog-low-battery` | 豆豆電量 15%、沒在充電：紅色「!」＋放大；小黑 15% 但在充電：沒有角標 |
| `dogs-indoor-stacked` | 豆豆、小黑、阿福在同一個狗舍停在原處（相距幾公尺）：小房子，名稱牌合成「3 隻・室內」；狗 5 在外面 |
| `dogs-overlap` | 豆豆、小黑、阿福走在一起：名稱牌合成「3 隻」，阿福電量低所以小標有紅點；點「3 隻」跳出重疊小選單 |
| `dog-never-fixed` | 訊號源 9 一直有封包但從沒定位：地圖上不畫 |
| `dog-stale-24h` | 阿福最後位置是 26 小時前：照樣畫在地圖上（灰色＋紅色「!」） |
| `dogs-offscreen` | 只有豆豆在接收器 7、走在手機旁邊（第一個畫面框住牠和手機）；五隻雲端狗在西邊 2–3 公里：左邊一個提示，三個小頭像（阿福 40 分鐘沒有新位置，排第一、紅框）＋「+2」；狗 9 在東邊 2.5 公里：右邊一個提示 |
| `cold-start-far-cloud` | 豆豆、狗 5 在接收器 7、手機旁邊；阿福的最後位置是 26 小時前、約 10 公里外（雲端）：第一個畫面只框本機的狗和手機（阿福用邊緣提示），按「框住全部」才把阿福框進來 |
| `cloud-only` | 沒設定接收器，小黑、阿福只從雲端來：不畫範圍圈、沒有接收範圍判定 |
| `card-ok` | 豆豆的卡片：在範圍內、62%、休息中 已 18 分鐘（沒有「位置」列） |
| `card-near-edge` | A3：豆豆 880 m，「接收範圍」琥珀「快離開接收範圍」 |
| `card-problems` | A3b：豆豆 09:05 之後沒有新位置、15%、不在接收範圍，活動量「—」 |
| `card-indoor` | A7b：小黑停在原處（室內）、充電中 62%、休息中 已 40 分鐘，沒有「接收範圍」列 |
| `card-cloud-dog` | 小黑只從雲端來：沒有「接收範圍」列；劇烈活動 |
| `card-phone-no-fix` | 手機最後定位 15 分鐘前：方向距離改寫「手機沒有定位」 |
| `card-readings-old` | 豆豆位置是新的，但電量、活動量 09:11 之後沒有讀數：「62%（09:11）」「休息中 已 12 分鐘（09:11）」 |
| `dog-edit` | `card-ok` 再按鉛筆：豆豆的個人頁（A5）蓋在卡片上 |
| `dog-photo-avatar` | 小黑用照片當頭像（新位置、彩色），地圖和卡片都是照片 |
| `dog-photo-stale` | `dogs-aged` 裡的阿福用照片當頭像：40 分鐘沒有新位置，地圖和卡片上的照片都轉灰階（白框、紅色「!」照原色） |
| `phone-recording` | 和 `all-good` 一樣：記錄中、今天走了 2.7 km → 右下藍色走路小人「今天 2.7 km」（A1） |
| `phone-recording-off` | 09:05 關掉記錄、之前走了 2.7 km → 灰色走路小人、灰字「今天 2.7 km」 |
| `phone-no-permission` | 定位權限被拿掉（之前走了 2.7 km）→ 灰色走路小人加斜線、灰字「今天 2.7 km」（A2）；沒有藍點 |
| `phone-no-route` | 記錄關著、今天沒有任何路線（只有昨天的）→ 灰色「未記錄」 |

## 新增情境（之後每個 PR）

1. 在 `ScreenFixtures.js` 的 `FIXTURES` 加一個 `'名稱': now => ({ receiver, cloud, phone, ble, cloudRows })`。用檔案裡的 `bleRow`／`cloudRow`／`series`／`at` 產生列，時間一律寫成 `now - …`。
2. 畫面需要新的輸入時：先讓畫面從 props 收這個輸入，再在 `buildFixture` 產生、在 `applyScreenFixture`（App 交給地圖的輸入）或 `MapScreen` 的 `fixture` 參數換掉。不要在畫面裡判斷「是不是情境」。
3. 在 `__tests__/ScreenFixtures.test.js` 加一個測試，用畫面同一套函式檢查這個情境真的產生名字說的狀態。
4. 截圖並和設計稿同一段並排放進 PR。

## 截圖

```bash
npm start                                  # Metro（另一個終端機或背景）
adb reverse tcp:8081 tcp:8081
cd android && ./gradlew -q installDebug && cd ..
# 打開 App、停在即時地圖，等冷啟動完成
scripts/fixture-screenshots.sh <輸出資料夾> [名稱 …]   # 不給名稱就全部
```

腳本會把狀態列時鐘設成 09:30（Android demo mode），每個情境等 App 記錄 `[ScreenFixture] showing <名稱>` 後再等 `FIXTURE_WAIT`（預設 8）秒讓地圖移動和載入圖磚，最後切回 `off` 並關掉 demo mode。只想手動看一個：

```bash
adb shell am start -a android.intent.action.VIEW -d 'dogtracker://dev/fixture?name=dog-indoor' com.dogtracker
```
