import { coverageNotice } from '../src/mapHistory/HistoryCoverage';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const preferences = extra => ({ ...HISTORY_DEFAULTS, phone: false,
  client: true, master: 7, slave: 4, hours: 3, ...extra });
const cloudRow = (eventId, receivedAt) => ({
  event_id: eventId, master_id: 7, slave_id: 4, received_at: receivedAt,
  slave_lat: 25, slave_lon: 121, activity_valid: 0, battery_valid: 0,
});

test('a range that starts before the stored rows says so instead of drawing a gap', () => {
  const notice = coverageNotice({ since: NOW - 6 * HOUR, coverage:
    { source: 'cloud', rows: 120, from: NOW - 2 * HOUR } });
  expect(notice).toContain('本機雲端副本最早只到');
  // The card downloads the missing range itself now, so the notice says what
  // 套用 will do instead of naming another screen to visit.
  expect(notice).toContain('按「套用」會自動從雲端補下載');
});

test('BLE retention is named as the reason, not the cloud page', () => {
  const notice = coverageNotice({ since: NOW - 6 * HOUR, coverage:
    { source: 'ble', rows: 120, from: NOW - 2 * HOUR } });
  expect(notice).toContain('本機 BLE 資料最早只到');
  expect(notice).toContain('10,000 筆');
});

test('no stored row for the device is called out, because the map would just look empty', () => {
  expect(coverageNotice({ since: NOW - HOUR, coverage: { source: 'cloud', rows: 0, from: null } }))
    .toContain('沒有這台 Master／Slave 的任何紀錄');
});

test('a fully covered range stays quiet', () => {
  expect(coverageNotice({ since: NOW - HOUR, coverage:
    { source: 'cloud', rows: 50, from: NOW - 5 * HOUR } })).toBe('');
  expect(coverageNotice({ since: NOW - HOUR, coverage: null })).toBe('');
  expect(coverageNotice(null)).toBe('');
});

test('reading history reports what the phone actually stores for the selected device', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    await cloud.savePage('account-a', [
      cloudRow('c1', NOW - 2 * HOUR), cloudRow('c2', NOW - HOUR),
    ]);
    // Three hours were asked for, the phone only downloaded the last two.
    const covered = await history.read(preferences({ source: 'cloud' }), 'account-a', NOW);
    expect(covered.coverage).toEqual({ source: 'cloud', rows: 2, from: NOW - 2 * HOUR });
    expect(coverageNotice(covered)).toContain('本機雲端副本最早只到');
    expect(covered.clients[0].count).toBe(2);
    // Another account's copy must not count as coverage for this one.
    const other = await history.read(preferences({ source: 'cloud' }), 'account-b', NOW);
    expect(other.coverage).toEqual({ source: 'cloud', rows: 0, from: null });
    // BLE reads the hardware table, which this fixture never filled.
    const ble = await history.read(preferences({ source: 'ble' }), 'account-a', NOW);
    expect(ble.coverage).toEqual({ source: 'ble', rows: 0, from: null });
  } finally { connection.close(); }
});
