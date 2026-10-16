// 2026-10-16, the user's phone: dogs 8, 104 and 108 (newer firmware) send
// "activityValid": 1, "activityScore": 0 while on their chargers
// ("usbPresent": 1), and the cards said 「休息中・超過 6 小時」. A collar on
// USB power is not a resting dog: the card says 「充電中」, A4 shows those
// minutes as 充電中 (not 休息, not 沒有資料), and a rest that begins when the
// charger comes off starts there.
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { dogCardReadings, CARD_ACTIVITY_LOOKBACK_MS } from '../src/activity/DogCardReadings';
import { activityMinutes, activityReadings, activityState } from '../src/activity/ActivityMinutes';
import { activityViewInput } from '../src/activity/ActivityData';
import { buildActivityView } from '../src/activity/views';
import { activityRow } from '../src/map/DogCardModel';

const MINUTE = 60000;
const NOW = new Date(2026, 9, 16, 14, 33).getTime();
const OWNER = '11111111-1111-4111-8111-111111111111';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Dog 8 from receiver 7 over Wi-Fi, one row every 30 s from `from` to `to`
// minutes ago: on the charger (score 0, valid 1, usbPresent 1) or not.
function cloudRows({ from, to, usb, score, start = 1 }) {
  const rows = [];
  for (let n = start, at = NOW - from * MINUTE; at < NOW - to * MINUTE; n += 1, at += 30000) {
    rows.push({ event_id: uuid(n), received_at: new Date(at).toISOString(), master_id: 7, slave_id: 8, seq: n % 65536,
      rssi: -80, snr: 6, upload_source: 'wifi', phone_received_at: null,
      payload: { lat: 24989200, lon: 121313800, speed: 0, satellites: 9, hdop: 110, gpsTimestamp: n,
        activityScore: score, activityValid: 1, activityTimestamp: n, usbPresent: usb,
        batteryMillivolts: 4100, batteryPercentage: 88, batteryValid: 1, slaveId: 8 } });
  }
  return rows;
}

async function withCloud(rows, run) {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize?.();
    await database.savePage(OWNER, rows.map(mapCloudTelemetry));
    return await run(database);
  } finally { connection.close(); }
}

test('a collar on its charger all day: the card says 充電中, never 休息中', async () => {
  await withCloud(cloudRows({ from: 8 * 60, to: 0, usb: 1, score: 0 }), async database => {
    const rows = await database.dogCardRows(OWNER, 8, NOW - CARD_ACTIVITY_LOOKBACK_MS);
    const { activity } = dogCardReadings(rows, NOW);
    // Even before the dog's own newest packet says so (the minutes do).
    expect(activityRow(activity, { reference: NOW, positionAt: NOW - 30000, stale: false }))
      .toMatchObject({ word: '充電中', detail: null, tone: 'charging' });
    expect(activityRow(activity, { reference: NOW, positionAt: NOW - 30000, stale: false, charging: true }))
      .toMatchObject({ word: '充電中', tone: 'charging' });
    // No new position: 「—」 as before.
    expect(activityRow(activity, { reference: NOW, positionAt: NOW - 30000, stale: true, charging: true }))
      .toMatchObject({ word: '—' });
  });
});

test('a rest that begins when the charger comes off starts there', async () => {
  const rows = [...cloudRows({ from: 5 * 60, to: 40, usb: 1, score: 0 }),
    ...cloudRows({ from: 40, to: 0, usb: 0, score: 20, start: 100000 })];
  await withCloud(rows, async database => {
    const read = await database.dogCardRows(OWNER, 8, NOW - CARD_ACTIVITY_LOOKBACK_MS);
    const { activity } = dogCardReadings(read, NOW);
    expect(activityRow(activity, { reference: NOW, positionAt: NOW - 30000, stale: false }))
      .toMatchObject({ word: '休息中', detail: '已 40 分鐘' });
  });
});

test('charging readings marked invalid still count as 充電中 minutes', () => {
  const readings = activityReadings([
    { time: NOW - 3 * MINUTE, activity: 0, activity_valid: 0, usb_present: 1, slave_id: 8 },
    { time: NOW - 2 * MINUTE, activity: 0.02, activity_valid: 1, usb_present: 0, slave_id: 8 },
  ], 'ble');
  const minutes = activityMinutes(readings, { now: NOW });
  expect(minutes.map(item => !!item.charging)).toEqual([true, false]);
  expect(activityState(minutes, { end: NOW - 3 * MINUTE }).state).toBe('charging');
});

test('A4: the charger\'s minutes are their own state, out of the rest totals', async () => {
  const rows = [...cloudRows({ from: 5 * 60, to: 40, usb: 1, score: 0 }),
    ...cloudRows({ from: 40, to: 0, usb: 0, score: 20, start: 100000 })];
  await withCloud(rows, async database => {
    const start = new Date(2026, 9, 16).getTime();
    for (const detail of ['raw', 'minute']) {
      const answer = await database.activityPeriod(OWNER, 8, { start, end: start + 24 * 60 * MINUTE, detail });
      const view = buildActivityView({ mode: 'day', date: NOW, now: NOW, earliest: start, since: NOW - 5 * 60 * MINUTE,
        ...activityViewInput(answer) });
      expect(view.totals.charging).toBe(5 * 60 - 40);
      expect(view.totals.rest).toBe(40);
      expect(view.rows.find(row => row.state === 'charging').rangeLabels).toEqual(['09:33–13:53']);
    }
  });
});

test('one rule for 充電中: the stored column or the wire flag, 1 or true; unknown is not charging', () => {
  const { isCharging, chargingSql } = require('../src/models/UsbPresent');
  expect([{ usb_present: 1 }, { usb_present: true }, { usb_present: '1' }, { usbPresent: 1 }].map(isCharging))
    .toEqual([true, true, true, true]);
  expect([{ usb_present: 0 }, { usb_present: null }, {}, null, { usbPresent: false }].map(isCharging))
    .toEqual([false, false, false, false, false]);
  expect(chargingSql('c.usb_present')).toBe('c.usb_present=1');
});
