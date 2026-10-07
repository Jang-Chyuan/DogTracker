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
| 雲端同步狀態 | `useCloudSync` 的 `ownerId`、`lastSuccess`、`error` | 地圖收到的 `cloudSync` |
| 手機位置／路線 | 現在位置（`useLiveLocation` 的樣子）和最近 10 分鐘的路線 | 地圖上的手機點；路線交給真的 `RideAlong` 判斷坐車 |
| 狗的名字 | `dogAliases`（4 豆豆、6 小黑、8 阿福） | 名稱牌 |
| 時鐘 | 固定 `FIXTURE_NOW` = 2026-10-07 09:30（台灣） | 地圖的 `now`（取代 `useMapClock`） |

地圖顯示偏好（隱藏的狗、跟隨）在情境裡一律忽略，截圖不受這支手機存的設定影響。所有座標都是桃園車站附近捏造的位置，不要用真實資料的區域。

## 現有情境

| 名稱 | 狀態 |
| --- | --- |
| `all-good` | 接收器 7 收資料中、雲端同步正常、三隻狗都是新的、手機記錄中 |
| `no-data` | 沒設定接收器、雲端沒有資料（已登入）、沒有任何狗 |
| `receiver-connecting` | 接收器 7 剛選好還沒收到資料；最新一筆封包來自之前用的接收器 3，不能當成 7 畫 |
| `receiver-disconnected` | 接收器 7 五分鐘前斷線、自動重連中；牠收的豆豆不再更新 |
| `dog-indoor` | 小黑進室內 12 分鐘：先有清楚定位，之後封包沒定位 → 真的 hold 規則判「室內」 |
| `dogs-aged` | 豆豆最新、小黑 4 分鐘前、阿福 40 分鐘前 |
| `range-out` | 豆豆從接收器 7 走到 1.3 公里外：不在接收範圍，從範圍圈邊緣拉紅色虛線 |
| `range-near-edge` | 豆豆在 880 m（快離開，800 m–1 km）：圈內、不畫線，卡片才變琥珀（046） |
| `range-returning` | 豆豆出去 1.3 公里後走回 950 m：還沒解除（要 900 m 內 2 筆、跨 2 分鐘），仍是圈外，但畫在圈內所以不畫線 |
| `range-stale-inside` | 小黑快 3 分鐘沒有新位置，最後一筆時在範圍內（780 m）；之後接收器往反方向走 300 m，那個位置現在落在圈外 → 判定停在最後一筆，不畫線 |
| `cloud-only` | 沒設定接收器，小黑、阿福只從雲端來：不畫範圍圈、沒有接收範圍判定 |

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
