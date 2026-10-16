import { t as i18nT } from '../src/i18n';
import { activityRow, cardHeadline, dogCard, phoneReading } from '../src/map/DogCardModel';
import { bearingAndDistance, compassWord, formatDistance } from '../src/map/DogReadout';
import { activityMinutes, activityReadings } from '../src/activity/ActivityMinutes';
import { RANGE_STATUS } from '../src/tracking/ReceiverRange';

const MINUTE = 60000;
const NOW = new Date(2026, 9, 7, 9, 30, 0).getTime();
const HOME = { latitude: 24.9893, longitude: 121.3135 };
// ~850 m north-east of HOME.
const NE = { latitude: 24.9947, longitude: 121.3194 };
const phone = { running: true, position: { ...HOME, timestamp: NOW - 2000 }, ageSeconds: 2 };
const dog = (extra = {}) => ({ slaveId: 6, coordinate: NE, fixAt: NOW - 5000, fixSource: 'ble',
  packetAt: NOW - 5000, packetSource: 'ble', batteryPercentage: 62, charging: false, ...extra });
const fresh = { drawn: true, stale: false, basis: 'position', source: 'ble', lastAt: NOW - 5000 };
const stale = { drawn: true, stale: true, basis: 'position', source: 'ble', lastAt: new Date(2026, 9, 7, 9, 5).getTime() };
const range = status => ({ status, judgedAt: NOW - 5000, cloudOnly: false });
const card = (d, options = {}) => dogCard(d, { freshness: fresh, phone: phoneReading(phone, NOW), now: NOW,
  name: '小黑', ...options });
const row = (model, key) => model.rows.find(item => item.key === key);

test('distance and bearing, the shared distance steps, compass words', () => {
  const { metres, bearing } = bearingAndDistance(HOME, NE);
  expect(metres).toBeGreaterThan(800);
  expect(metres).toBeLessThan(900);
  expect(bearing).toBeGreaterThan(30);
  expect(bearing).toBeLessThan(60);
  expect(compassWord(bearing)).toBe(i18nT("c739"));
  // 2026-10-13: one formatter with the history list (utils/distanceText):
  // 5 m steps under 100 m, 10 m steps to 1 km, then km with one decimal.
  expect(formatDistance(7.4)).toBe('5 m');
  expect(formatDistance(847)).toBe('850 m');
  expect(formatDistance(998)).toBe('1.0 km');
  expect(formatDistance(1420)).toBe('1.4 km');
  expect(formatDistance(12400)).toBe('12.4 km');
});

test('A3: a fresh dog in range — always three rows: 接收範圍 (with the distance), 電量, 活動量', () => {
  const model = card(dog(), { range: range(RANGE_STATUS.IN) });
  expect(model.sourceLabel).toBe('訊號源 6');
  expect(model.rows.map(item => item.key)).toEqual(['range', 'battery', 'activity']);
  expect(row(model, 'battery')).toMatchObject({ value: '62%', tone: null });
  expect(row(model, 'range')).toMatchObject({ value: i18nT('c348'), tone: null, alert: null });
  expect(row(model, 'activity')).toMatchObject({ value: '—', pressable: true });
  expect(model.headline).toEqual({ kind: 'distance', distance: '850 m', bearing: expect.any(Number),
    compass: i18nT('c739'), phoneAge: null });
  // TalkBack reads the distance with the first row.
  expect(row(model, 'range').speech).toBe('接收範圍，在範圍內，東北方 850 公尺，離手機');
  // No receiver row, ever.
  expect(model.rows.some(item => item.label === i18nT('c075'))).toBe(false);
});

test('快離開: amber, without a distance; out of range: red', () => {
  expect(row(card(dog(), { range: range(RANGE_STATUS.NEAR) }), 'range'))
    .toMatchObject({ value: i18nT('c067'), tone: 'warn' });
  expect(row(card(dog(), { range: range(RANGE_STATUS.OUT) }), 'range'))
    .toMatchObject({ value: i18nT('c078'), tone: 'crit' });
  // A cloud dog (never judged by this phone): 位置 「最後 HH:MM」, its
  // newest position's time, still three rows.
  const cloud = card(dog({ fixAt: new Date(2026, 9, 7, 9, 29).getTime() }), { range: null });
  expect(cloud.rows.map(item => item.key)).toEqual(['position', 'battery', 'activity']);
  expect(row(cloud, 'position')).toMatchObject({ value: '09:29 更新', tone: null, detail: null, alert: null });
  expect(row(cloud, 'position').speech).toBe('位置，09:29 更新，東北方 850 公尺，離手機');
});

test('A3b: stale — 位置 row in red, distance to the last position; out of range too: its own line in the row', () => {
  const model = card(dog({ batteryPercentage: 15 }), { freshness: stale, range: range(RANGE_STATUS.OUT) });
  expect(model.rows.map(item => item.key)).toEqual(['position', 'battery', 'activity']);
  expect(row(model, 'position')).toMatchObject({ value: '09:05 之後沒有新位置', tone: 'crit',
    alert: i18nT('c078'), twoLine: true });
  expect(row(model, 'battery')).toMatchObject({ value: '15%・偏低', tone: 'crit' });
  expect(model.headline.distance).toBe('850 m');
  expect(model.rows.map(item => item.speech))
    .toEqual(['位置，09:05 之後沒有新位置，不在接收範圍，東北方 850 公尺，離手機', '電量 15%，偏低', '活動量，沒有資料']);
  // In range or 快離開 while stale: the row says only 沒有新位置 (one line).
  expect(row(card(dog(), { freshness: stale, range: range(RANGE_STATUS.NEAR) }), 'position'))
    .toMatchObject({ value: '09:05 之後沒有新位置', alert: null, twoLine: false });
});

test('battery: 20% is low, 21% is not, charging never is; unknown is 「—」', () => {
  expect(row(card(dog({ batteryPercentage: 20 })), 'battery')).toMatchObject({ value: '20%・偏低', tone: 'crit' });
  expect(row(card(dog({ batteryPercentage: 21 })), 'battery')).toMatchObject({ value: '21%', tone: null });
  expect(row(card(dog({ batteryPercentage: 15, charging: true })), 'battery'))
    .toMatchObject({ value: '充電中 15%', tone: null });
  expect(row(card(dog({ batteryPercentage: null })), 'battery')).toMatchObject({ value: '—', tone: null });
});

test('a battery reading 10 minutes older than the position carries its time', () => {
  const at = new Date(2026, 9, 7, 9, 12).getTime();
  // The newest packet had no valid battery: the card's own read is the newest.
  const noBattery = dog({ batteryPercentage: null });
  expect(row(card(noBattery, { battery: { percentage: 62, charging: false, at } }), 'battery').value).toBe('62%（09:12）');
  expect(row(card({ ...noBattery, charging: true }, { battery: { percentage: 62, at } }), 'battery').value)
    .toBe('充電中 62%（09:12）');
  // A newer packet beats an older read, and an older read's charging does
  // not survive unplugging.
  expect(row(card(dog({ batteryPercentage: 15 }), { battery: { percentage: 62, charging: true, at } }), 'battery'))
    .toMatchObject({ value: '15%・偏低', tone: 'crit' });
  // Nine minutes older: no time.
  expect(row(card(dog(), { battery: { percentage: 62, at: NOW - 5000 - 9 * MINUTE } }), 'battery').value).toBe('62%');
  // Held indoors, it is compared with the newest packet, not the held point.
  const held = dog({ heldReason: '室內', heldSource: 'weak', fixAt: NOW - 3 * 3600000, packetAt: NOW - 5000 });
  expect(row(card({ ...held, batteryPercentage: null }, { battery: { percentage: 62, at: NOW - 6000 } }), 'battery').value)
    .toBe('62%');
});

test('A7b: held indoors — 位置 「室內」 (address line when known), no 接收範圍 row', () => {
  const held = dog({ heldReason: '室內', heldSource: 'weak' });
  const freshness = { ...fresh, basis: 'packet' };
  const model = card(held, { freshness, range: range(RANGE_STATUS.NEAR), address: '桃園區中正路 1 號附近' });
  expect(model.rows.map(item => item.key)).toEqual(['position', 'battery', 'activity']);
  expect(row(model, 'position')).toMatchObject({ value: i18nT('c114'), tone: null, detail: '桃園區中正路 1 號附近',
    speech: '位置，室內，桃園區中正路 1 號附近，東北方 850 公尺，離手機' });
  // Out of range before it was held: still one row, its last line says so,
  // with the time it was confirmed (red 「!」, the 室內 words stay black).
  const out = card(held, { freshness, address: '桃園區中正路 1 號附近',
    range: { ...range(RANGE_STATUS.OUT), judgedAt: new Date(2026, 9, 7, 9, 5).getTime() } });
  expect(out.rows.map(item => item.key)).toEqual(['position', 'battery', 'activity']);
  expect(row(out, 'position')).toMatchObject({ value: i18nT('c114'), tone: null, detail: '桃園區中正路 1 號附近',
    alert: '不在接收範圍・最後確認 09:05' });
  // Held and stale: 沒有新資料 in red over the same address.
  const silent = card(held, { freshness: { ...stale, basis: 'packet' }, address: '桃園區中正路 1 號附近' });
  expect(row(silent, 'position')).toMatchObject({ value: '09:05 之後沒有新資料', tone: 'crit',
    detail: '桃園區中正路 1 號附近', twoLine: true });
});

// 2026-10-13: the card's 室內 minutes are the history's for the same hold
// (HistoryStops.historyIndoorNodes, HistoryTimelinePresentation): from the first
// row the hold covers (heldFrom, HoldStore) to its newest packet, in whole clock
// minutes — not the 活動量 row's rest, which is the collar's motion.
test('A7b: 室內・N 分 counts as the history does, apart from the 活動量 rest', () => {
  const from = new Date(2026, 9, 7, 9, 3, 50).getTime();
  const held = dog({ heldReason: '室內', heldSource: 'good', heldSince: from - 4 * MINUTE, heldFrom: from,
    packetAt: new Date(2026, 9, 7, 9, 29, 10).getTime() });
  const freshness = { ...fresh, basis: 'packet' };
  // Calm only for the last 12 minutes (the dog moved about inside before).
  const rows = [];
  for (let time = NOW - 40 * MINUTE; time < NOW; time += 10000) {
    rows.push({ time, activity: time < NOW - 12 * MINUTE ? 0.3 : 0.02, slave_id: 6 });
  }
  const activity = { minutes: activityMinutes(activityReadings(rows, 'ble'), { now: NOW }), newestAt: NOW - 10000 };
  const model = card(held, { freshness, address: '桃園區中正路 1 號附近', activity });
  // 09:03 → 09:29 on the clock: 26 minutes, as the history's 「室內・26 分」.
  expect(row(model, 'position')).toMatchObject({ value: '室內・26 分', detail: '桃園區中正路 1 號附近', twoLine: true,
    speech: '位置，室內，26 分，桃園區中正路 1 號附近，東北方 850 公尺，離手機' });
  expect(row(model, 'activity')).toMatchObject({ value: i18nT('c069'), detail: '已 12 分鐘',
    speech: '活動量，休息中，活動量低已 12 分鐘' });
  // Without heldFrom (an older merged dog) it counts from heldSince; past an
  // hour it reads as the history's list (「1 時 13 分」).
  const { heldFrom, ...older } = held;
  expect(heldFrom).toBe(from);
  expect(row(card({ ...older, heldSince: from - 47 * MINUTE }, { freshness }), 'position').value).toBe('室內・1 時 13 分');
  // No times at all: 「室內」 alone, as before.
  expect(row(card({ ...older, heldSince: undefined }, { freshness }), 'position').value).toBe(i18nT('c114'));
  // Stale indoors: the row still says 沒有新資料, no minutes.
  expect(row(card(held, { freshness: { ...stale, basis: 'packet' } }), 'position').value).toBe('09:05 之後沒有新資料');
});

test('battery: a reading kept from an earlier packet (DogMerge batteryAt) carries its time when old', () => {
  // The newest packet said 0% without an empty cell's voltage: DogMerge kept
  // 43% from 09:12 (BatteryPlausibility), so that is what the card shows.
  const at = new Date(2026, 9, 7, 9, 12).getTime();
  expect(row(card(dog({ batteryPercentage: 43, batteryAt: at })), 'battery')).toMatchObject({ value: '43%（09:12）', tone: null });
  expect(row(card(dog({ batteryPercentage: 43, batteryAt: NOW - 6000 })), 'battery').value).toBe('43%');
});

test('the phone: none or over 10 minutes old is 手機沒有定位; 30 s to 10 minutes says how old', () => {
  expect(phoneReading({ running: false, position: phone.position }, NOW)).toBeNull();
  expect(phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 11 * MINUTE } }, NOW)).toBeNull();
  const model = card(dog(), { phone: null });
  expect(model.headline).toEqual({ kind: 'no-phone', text: i18nT("c726") });
  expect(model.rows[0].speech).toBe('位置，09:29 更新，手機沒有定位');
  const threeMinutes = phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 3 * MINUTE - 5000 } }, NOW);
  expect(cardHeadline({ dog: dog(), phone: threeMinutes }).phoneAge).toBe('手機位置 3 分鐘前');
  expect(card(dog(), { phone: threeMinutes, range: range(RANGE_STATUS.IN) }).rows[0].speech)
    .toBe('接收範圍，在範圍內，東北方 850 公尺，離手機，手機位置 3 分鐘前');
  const twentySeconds = phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 20000 } }, NOW);
  expect(cardHeadline({ dog: dog(), phone: twentySeconds }).phoneAge).toBeNull();
});

test('活動量: judged at now; 「—」 when stale; old readings judged when they stopped, with their time', () => {
  const rows = [];
  for (let time = NOW - 40 * MINUTE; time < NOW; time += 10000) rows.push({ time, activity: 0.02, slave_id: 6 });
  const minutes = activityMinutes(activityReadings(rows, 'ble'), { now: NOW });
  const activity = { minutes, newestAt: NOW - 10000 };
  expect(activityRow(activity, { reference: NOW, positionAt: NOW - 5000, stale: false }))
    .toMatchObject({ word: i18nT('c069'), detail: '已 40 分鐘', at: null });
  expect(activityRow(activity, { reference: NOW, positionAt: NOW - 5000, stale: true }).word).toBe('—');
  const stopped = rows.filter(item => item.time < NOW - 20 * MINUTE);
  const old = { minutes: activityMinutes(activityReadings(stopped, 'ble'), { now: NOW }), newestAt: stopped.at(-1).time };
  const result = activityRow(old, { reference: NOW, positionAt: NOW - 5000, stale: false });
  expect(result).toMatchObject({ word: i18nT('c069'), detail: '已 20 分鐘', at: stopped.at(-1).time });
  const model = card(dog(), { activity: old });
  // TalkBack: the minutes are the collar's low motion, not the 室內 minutes.
  expect(row(model, 'activity').speech).toBe('活動量，休息中，活動量低已 20 分鐘，09:09');
});

test('活動量: readings a few minutes behind the position are judged up to their newest minute, not 「—」', () => {
  // 2026-10-13: the downloaded archive the card reads trailed the latest
  // positions after a cold start; four minutes behind read 「沒有資料」.
  const rows = [];
  for (let time = NOW - 40 * MINUTE; time < NOW - 4 * MINUTE; time += 10000) rows.push({ time, activity: 0.02, slave_id: 6 });
  const activity = { minutes: activityMinutes(activityReadings(rows, 'ble'), { now: NOW }), newestAt: rows.at(-1).time };
  expect(activityRow(activity, { reference: NOW, positionAt: NOW - 5000, stale: false }))
    .toMatchObject({ word: i18nT('c069'), detail: '已 36 分鐘', at: null });
});

test('the card falls back to the map blue dot when the recording service has no fix', () => {
  const { nativePhoneReading } = require('../src/map/DogCardModel');
  const now = 1_000_000;
  expect(nativePhoneReading({ latitude: 24.99, longitude: 121.31, receivedAt: now - 5000 }, now))
    .toEqual({ coordinate: { latitude: 24.99, longitude: 121.31 }, ageMs: 5000 });
  expect(nativePhoneReading({ latitude: 24.99, longitude: 121.31, receivedAt: now - 11 * 60 * 1000 }, now)).toBeNull();
  expect(nativePhoneReading(null, now)).toBeNull();
});

// 2026-10-15: a rest as long as the card's six-hour lookback read 「已 5 小時
// 58 分」「已 6 小時」 by turns as the window slid; now 「休息中・超過 6 小時」.
test('活動量: a rest reaching back to where the readings begin is 「超過 6 小時」, steady as the clock moves', () => {
  const { dogCardReadings, CARD_ACTIVITY_LOOKBACK_MS } = require('../src/activity/DogCardReadings');
  const details = [];
  for (let step = 0; step < 4; step += 1) {
    const now = NOW + step * 40000;
    const since = now - CARD_ACTIVITY_LOOKBACK_MS;
    const local = [];
    for (let time = since + 7000; time < now; time += 30000) {
      local.push({ time, activity: 0.02, activity_valid: 1, slave_id: 6, master_id: 7 });
    }
    const { activity } = dogCardReadings({ local, cloud: [], battery: [], since }, now);
    const words = activityRow(activity, { reference: now, positionAt: now - 5000, stale: false });
    details.push([words.word, words.detail, words.speechDetail]);
  }
  expect(new Set(details.map(item => item.join('|'))).size).toBe(1);
  expect(details[0]).toEqual([i18nT('c069'), '超過 6 小時', '活動量低超過 6 小時']);
  // A reader that does not say where its rows begin: the minutes as before.
  const rows = [];
  for (let time = NOW - 40 * MINUTE; time < NOW; time += 10000) rows.push({ time, activity: 0.02, slave_id: 6 });
  const activity = { minutes: activityMinutes(activityReadings(rows, 'ble'), { now: NOW }), newestAt: NOW - 10000 };
  expect(activityRow(activity, { reference: NOW, positionAt: NOW - 5000, stale: false }).detail).toBe('已 40 分鐘');
});
