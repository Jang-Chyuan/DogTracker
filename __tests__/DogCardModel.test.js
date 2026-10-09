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

test('distance and bearing, five-metre steps, compass words', () => {
  const { metres, bearing } = bearingAndDistance(HOME, NE);
  expect(metres).toBeGreaterThan(800);
  expect(metres).toBeLessThan(900);
  expect(bearing).toBeGreaterThan(30);
  expect(bearing).toBeLessThan(60);
  expect(compassWord(bearing)).toBe('東北');
  expect(formatDistance(7.4)).toBe('7 m');
  expect(formatDistance(847)).toBe('845 m');
  expect(formatDistance(998)).toBe('1.0 km');
  expect(formatDistance(1420)).toBe('1.4 km');
  expect(formatDistance(12400)).toBe('12 km');
});

test('A3: a fresh dog in range — 電量, 接收範圍, 活動量, no 位置 row', () => {
  const model = card(dog(), { range: range(RANGE_STATUS.IN) });
  expect(model.sourceLabel).toBe('訊號源 6');
  expect(model.rows.map(item => item.key)).toEqual(['battery', 'range', 'activity']);
  expect(row(model, 'battery')).toMatchObject({ value: '62%', tone: null });
  expect(row(model, 'range')).toMatchObject({ value: '在範圍內', tone: null });
  expect(row(model, 'activity')).toMatchObject({ value: '—', pressable: true });
  expect(model.headline).toMatchObject({ kind: 'distance', distance: '845 m', suffix: '離手機' });
  expect(model.headlineSpeech).toBe('小黑，東北方 845 公尺，離手機');
  // No receiver row, ever.
  expect(model.rows.some(item => item.label === '接收器')).toBe(false);
});

test('快離開: amber, without a distance; out of range: red', () => {
  expect(row(card(dog(), { range: range(RANGE_STATUS.NEAR) }), 'range'))
    .toMatchObject({ value: '快離開接收範圍', tone: 'warn' });
  expect(row(card(dog(), { range: range(RANGE_STATUS.OUT) }), 'range'))
    .toMatchObject({ value: '不在接收範圍', tone: 'crit' });
  // A cloud dog (never judged by this phone): no row at all.
  expect(card(dog(), { range: null }).rows.map(item => item.key)).toEqual(['battery', 'activity']);
});

test('A3b: stale — 位置 row in red, distance to the last position', () => {
  const model = card(dog({ batteryPercentage: 15 }), { freshness: stale, range: range(RANGE_STATUS.OUT) });
  expect(model.rows.map(item => item.key)).toEqual(['position', 'battery', 'range', 'activity']);
  expect(row(model, 'position')).toMatchObject({ value: '沒有新位置・最後 09:05', tone: 'crit' });
  expect(row(model, 'battery')).toMatchObject({ value: '15%・偏低', tone: 'crit' });
  expect(model.headline.suffix).toBe('離手機・最後位置');
  expect(model.rows.map(item => item.speech))
    .toEqual(['位置，沒有新位置，最後 09:05', '電量 15%，偏低', '接收範圍，不在接收範圍', '活動量，沒有資料']);
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

test('A7b: held indoors — 位置 「室內」 (address line when known), 離手機・室內, no 接收範圍 row', () => {
  const held = dog({ heldReason: '室內', heldSource: 'weak' });
  const freshness = { ...fresh, basis: 'packet' };
  const model = card(held, { freshness, range: range(RANGE_STATUS.NEAR), address: '桃園區中正路 1 號附近' });
  expect(model.rows.map(item => item.key)).toEqual(['position', 'battery', 'activity']);
  expect(row(model, 'position')).toMatchObject({ value: '室內', tone: null, detail: '桃園區中正路 1 號附近',
    speech: '位置，室內，桃園區中正路 1 號附近' });
  expect(model.headline.suffix).toBe('離手機・室內');
  // Out of range before it was held: the row stays, with the time it was confirmed.
  const out = card(held, { freshness, range: { ...range(RANGE_STATUS.OUT), judgedAt: new Date(2026, 9, 7, 9, 5).getTime() } });
  expect(row(out, 'range')).toMatchObject({ value: '不在接收範圍・最後確認 09:05', tone: 'crit' });
  // Held and stale: 沒有新資料, 室內・最後資料.
  const silent = card(held, { freshness: { ...stale, basis: 'packet' } });
  expect(row(silent, 'position')).toMatchObject({ value: '沒有新資料・最後 09:05', tone: 'crit' });
  expect(silent.headline.suffix).toBe('離手機・室內・最後資料');
});

test('the phone: none or over 10 minutes old is 手機沒有定位; 30 s to 10 minutes says how old', () => {
  expect(phoneReading({ running: false, position: phone.position }, NOW)).toBeNull();
  expect(phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 11 * MINUTE } }, NOW)).toBeNull();
  const model = card(dog(), { phone: null });
  expect(model.headline).toEqual({ kind: 'no-phone', text: '手機沒有定位' });
  expect(model.headlineSpeech).toBe('小黑，手機沒有定位');
  const threeMinutes = phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 3 * MINUTE - 5000 } }, NOW);
  expect(cardHeadline({ dog: dog(), phone: threeMinutes, indoor: false, stale: true }).suffix)
    .toBe('離手機・最後位置・手機位置 3 分鐘前');
  const twentySeconds = phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 20000 } }, NOW);
  expect(cardHeadline({ dog: dog(), phone: twentySeconds, indoor: false, stale: false }).suffix).toBe('離手機');
});

test('活動量: judged at now; 「—」 when stale; old readings judged when they stopped, with their time', () => {
  const rows = [];
  for (let time = NOW - 40 * MINUTE; time < NOW; time += 10000) rows.push({ time, activity: 0.02, slave_id: 6 });
  const minutes = activityMinutes(activityReadings(rows, 'ble'), { now: NOW });
  const activity = { minutes, newestAt: NOW - 10000 };
  expect(activityRow(activity, { reference: NOW, positionAt: NOW - 5000, stale: false }))
    .toMatchObject({ word: '休息中', detail: '已 40 分鐘', at: null });
  expect(activityRow(activity, { reference: NOW, positionAt: NOW - 5000, stale: true }).word).toBe('—');
  const stopped = rows.filter(item => item.time < NOW - 20 * MINUTE);
  const old = { minutes: activityMinutes(activityReadings(stopped, 'ble'), { now: NOW }), newestAt: stopped.at(-1).time };
  const result = activityRow(old, { reference: NOW, positionAt: NOW - 5000, stale: false });
  expect(result).toMatchObject({ word: '休息中', detail: '已 20 分鐘', at: stopped.at(-1).time });
  const model = card(dog(), { activity: old });
  expect(row(model, 'activity').speech).toBe('活動量，休息中，已 20 分鐘，09:09');
});

test('the card falls back to the map blue dot when the recording service has no fix', () => {
  const { nativePhoneReading } = require('../src/map/DogCardModel');
  const now = 1_000_000;
  expect(nativePhoneReading({ latitude: 24.99, longitude: 121.31, receivedAt: now - 5000 }, now))
    .toEqual({ coordinate: { latitude: 24.99, longitude: 121.31 }, ageMs: 5000 });
  expect(nativePhoneReading({ latitude: 24.99, longitude: 121.31, receivedAt: now - 11 * 60 * 1000 }, now)).toBeNull();
  expect(nativePhoneReading(null, now)).toBeNull();
});
