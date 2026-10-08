import { normalizeHistoryRows, historySourceStream, filterHistoryPoints } from '../src/history';
import { point, route } from '../__fixtures__/HistoryLogicFixtures';

// spec.txt「先照資料來源篩選；全部時才合併本機和雲端」。
test('source filtering precedes packet dedupe, local copy wins', () => {
  const cloud = point(0, 10, { source: 'cloud', slave_id: 1 });
  const local = point(0, 20, { source: 'ble', slave_id: 1 });
  expect(historySourceStream([cloud, local]).points).toEqual([expect.objectContaining({ latitude: local.latitude })]);
  expect(historySourceStream([cloud, local], { source: 'cloud' }).points[0].latitude).toBe(cloud.latitude);
  expect(historySourceStream([cloud, local], { source: 'local' }).points[0].source).toBe('ble');
});
// spec.txt「同一訊號源＋同一封包時間」「GPS 再另外照同一定位時間去重」。
test('two dedupe stages preserve packet state transitions', () => {
  const rows = [point(0, 0, { locationTime: 0, usb_present: 0 }), point(10, 0, { locationTime: 0, usb_present: 1 })];
  let replay;
  const result = historySourceStream(rows, { replayHolds: p => { replay = p; return p; } });
  expect(replay.map(p => p.usb_present)).toEqual([0, 1]);
  expect(result.packets).toHaveLength(2); expect(result.points).toHaveLength(1);
});
// spec.txt「不能用空的定位時間合併」。
test('null GPS times do not collapse packets or held observations', () => {
  const rows = [point(0, 0, { locationTime: null, heldReason: 'indoor' }), point(10, 0, { locationTime: null, heldReason: 'indoor' })];
  expect(historySourceStream(rows).packets).toHaveLength(2);
  expect(historySourceStream(rows).points).toHaveLength(2);
  expect(historySourceStream(rows.map(p => ({ ...p, heldReason: null }))).points).toHaveLength(0);
});
// spec.txt「同一訊號源（slave_id）、同一定位時間」。
test('different dogs never dedupe together', () => {
  expect(historySourceStream([point(0, 0, { slave_id: 1 }), point(0, 0, { slave_id: 2 })]).points).toHaveLength(2);
});
// spec.txt「時間用 UTC 存」「雲端來的寫封包本身的時間；不用下載時間」。
test('stored columns normalize without replacing null GPS time', () => {
  const [p] = normalizeHistoryRows([{ track_at: 123, received_at: 999, slave_lat: 25, slave_lon: 121, location_at: null, accuracy_meters: 5 }], 'cloud');
  expect(p).toMatchObject({ time: 123, packetTime: 123, locationTime: null, accuracy: 5 });
});
// stops.txt「判斷只用真的收到的位置（畫線時才補點）」。
test('synthetic and invalid fixes are excluded', () => {
  expect(filterHistoryPoints([point(0), point(10, 1, { synthetic: true }), point(20, 2, { interpolated: true }), point(30, 3, { latitude: 95 })])).toHaveLength(1);
});
// spec.txt「誤差 > 50 m…不畫、不算」「誤差 25–50 m：照畫」。
test('accuracy threshold includes 50 metres', () => {
  expect(filterHistoryPoints([point(0, 0, { accuracy: 50 }), point(10, 0, { accuracy: 50.1 })])).toHaveLength(1);
});
// spec.txt「跳點…不更新比較基準」。
test('phone jump does not poison next normal fix', () => {
  expect(filterHistoryPoints([point(0), point(1, 1000), point(2, 2)], { subject: 'phone' }).map(p => p.time)).toEqual([0, 2000]);
});
// spec.txt「連續 3 筆每秒 9–50 m 的線段…補回去當高速點保留」。
test('dog high-speed run keeps buffered fixes and its tail', () => {
  const points = route([20, 20, 20, 20, 20]);
  expect(filterHistoryPoints(points)).toEqual(points);
});
// spec.txt「湊不成、或任何一段超過每秒 50 m…照跳點丟掉」。
test('unconfirmed fast dog fix and over-50 run are removed', () => {
  expect(filterHistoryPoints([point(0), point(1, 20), point(2, 2)]).map(p => p.time)).toEqual([0, 2000]);
  expect(filterHistoryPoints(route([60, 60, 60]))).toHaveLength(1);
});
// spec.txt「兩筆都留著、各自記來源；先依資料來源篩選」。
test('input rows are immutable through hold replay', () => {
  const rows = [point(0)];
  historySourceStream(rows, { replayHolds: p => { p[0].heldReason = 'indoor'; return p; } });
  expect(rows[0].heldReason).toBeUndefined();
});

// spec.txt「連續3筆…9–50m…高速點保留」（包含之前已通過的一段）。
test('dog high-speed exception includes preceding accepted high edge', () => {
  const points = route([10, 20, 20]);
  expect(filterHistoryPoints(points)).toEqual(points);
});

// spec.txt「停住那段…畫在停住點」（弱定位的誤差不能刪掉已確認停住封包）。
test('held anchor survives poor raw accuracy while malformed time does not', () => {
  expect(filterHistoryPoints([point(0, 0, { accuracy: 100, heldReason: 'indoor' }), point(10, 0, { time: NaN })])).toHaveLength(1);
});
