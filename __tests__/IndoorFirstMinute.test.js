// 2026-10-15: an indoor hold's first minute read 「室內・0 分」 on the history
// list, the cursor and the live card; like a stay (「停 不到 1 分」) it says
// 「室內・不到 1 分」 (c1276).
import { t as i18nT } from '../src/i18n';
import { nodePill } from '../src/history/HistoryText';
import { cursorLabel } from '../src/history/screen';
import { dogCard, phoneReading } from '../src/map/DogCardModel';

const MINUTE = 60000;
const LESS = i18nT('c1276');

test('the list: an indoor capsule under half a minute is 室內・不到 1 分', () => {
  expect(nodePill({ type: 'indoor', start: 0, end: 20000 }).text).toBe(`室內・${LESS}`);
  expect(nodePill({ type: 'indoor', start: 0, end: 10 * MINUTE, displayDurationMs: 0 }).text).toBe(`室內・${LESS}`);
  expect(nodePill({ type: 'indoor', start: 0, end: 10 * MINUTE }).text).toBe('室內・10 分');
});

test('the cursor: 室內・不到 1 分 in the first minute', () => {
  const model = { points: [0, 1, 2].map(n => ({ time: n * 10000 })), sections: [],
    locations: [{ type: 'indoor', start: 0, end: 20000 }] };
  expect(cursorLabel(model, 10000)[1]).toBe(`室內・${LESS}`);
});

test('the live card: 室內・不到 1 分 in the first minute', () => {
  const now = new Date(2026, 9, 7, 9, 30, 20).getTime();
  const home = { latitude: 24.9893, longitude: 121.3135 };
  const phone = { running: true, position: { ...home, timestamp: now - 2000 }, ageSeconds: 2 };
  const from = new Date(2026, 9, 7, 9, 30, 2).getTime();
  const dog = { slaveId: 6, coordinate: { latitude: 24.9947, longitude: 121.3194 }, fixAt: now - 5000, fixSource: 'ble',
    packetAt: now - 3000, packetSource: 'ble', batteryPercentage: 62, charging: false,
    heldReason: '室內', heldSource: 'good', heldSince: from, heldFrom: from };
  const model = dogCard(dog, { freshness: { drawn: true, stale: false, basis: 'packet', source: 'ble', lastAt: now - 3000 },
    phone: phoneReading(phone, now), now, name: '小黑' });
  expect(model.rows.find(row => row.key === 'position').value).toBe(`室內・${LESS}`);
});
