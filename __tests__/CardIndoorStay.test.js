import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createHoldStore } from '../src/placement/HoldStore';
import { HOLD_CONFIG } from '../src/placement/IndoorHold';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { dogCard } from '../src/map/DogCardModel';
import { CARD_INDOOR_LOOKBACK_MS, historyHoldCandidates, historyStayAt, historyStayAtSoon, useHistoryHolds } from '../src/map/CardIndoorStay';
import { createHistoryDatabase, HISTORY_DAY_CONTEXT_MS } from '../src/mapHistory/HistoryDatabase';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

// 2026-10-13 (dog 108 on the emulator): the card said 「室內・30 分」 while the
// history's day began 「00:00 接續前一天」 with the cursor at 「室內・11 時 2
// 分」: the live hold replays only the last half hour on a cold start, so the
// first row it holds is where that half hour begins. All data made up.
const MINUTE = 60000;
const NOW = new Date('2026-10-13T09:30:00+08:00').getTime();
const INSIDE = new Date('2026-10-12T21:00:00+08:00').getTime();
const HOME = { latitude: 24.99, longitude: 121.31 };
const fresh = { stale: false, basis: 'packet' };

async function kennel({ from = INSIDE - 10 * MINUTE, until = NOW } = {}) {
  const db = createMemoryConnection();
  await createDogDatabase(db).initialize();
  const insert = (time, lat, lon, sats, hdop) => db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
    received_at,slave_lat,slave_lon,satellites,hdop,battery_percentage,battery_valid) VALUES(7,6,?,?,?,?,?,80,1)`,
  [time, lat, lon, sats, hdop]);
  // Clear fixes at the kennel for ten minutes, then packets without a fix.
  for (let time = from; time <= INSIDE; time += 30000) await insert(time, HOME.latitude, HOME.longitude, 9, 0.9);
  for (let time = INSIDE + 30000; time <= until; time += 30000) await insert(time, 0, 0, 0, 655.35);
  return db;
}

// As useCloudDogs on a cold start: CloudDatabase.holdRows → HoldStore → DogMerge.
async function coldStartDog(db) {
  const cloud = createCloudDatabase(db);
  await cloud.initialize();
  const store = createHoldStore();
  store.ingest(await cloud.holdRows(null, NOW - HOLD_LOOKBACK_MS, null));
  const packet = { slave_id: 6, master_id: 7, received_at: NOW, slave_lat: 0, slave_lon: 0,
    battery_percentage: 80, battery_valid: 1, source: 'ble' };
  const holds = store.holds(NOW);
  return { hold: holds[6], dog: mergeDogMarkers({ packetRows: [packet], holds, now: NOW, windowMs: 180000 })[0] };
}

const position = dog => dogCard(dog, { freshness: fresh, now: NOW, name: '小黑' })
  .rows.find(row => row.key === 'position').value;

describe('a stay begun before the live rows', () => {
  // 2026-10-16: the card no longer times a stay (no history read for it); a
  // hold the live rows only saw part of still says 「室內」.
  test('the live hold knows only that it began before its half hour; the card says 「室內」', async () => {
    const db = await kennel();
    try {
      const { hold, dog } = await coldStartDog(db);
      expect(hold.fromClipped).toBe(true);
      expect(dog.heldFromClipped).toBe(true);
      expect(dog.heldFrom).toBeGreaterThanOrEqual(NOW - HOLD_LOOKBACK_MS);
      expect(position(dog)).toBe('室內');
    } finally { db.close(); }
  });

  // Clear fixes from `from` to `to`: walking home from 450 m north, at the
  // door for the last two minutes. The tracker sees the dog arrive.
  const walkHome = (from, to) => {
    const rows = [];
    for (let time = from; time <= to; time += 30000) {
      const away = Math.max(0, (to - 2 * MINUTE - time) / (to - 2 * MINUTE - from)) * 0.004;
      rows.push({ slave_id: 6, master_id: 7, time, latitude: HOME.latitude + away, longitude: HOME.longitude,
        satellites: 9, hdop: 0.9, source: 'ble' });
    }
    return rows;
  };

  test('a hold the live rows saw begin is not clipped', () => {
    const store = createHoldStore();
    const rows = walkHome(NOW - 60 * MINUTE, NOW - 50 * MINUTE);
    for (let time = NOW - 50 * MINUTE + 30000; time <= NOW; time += 30000) {
      rows.push({ slave_id: 6, master_id: 7, time, latitude: 0, longitude: 0, satellites: 0, hdop: 655.35, source: 'ble' });
    }
    store.ingest({ rows });
    expect(store.holds(NOW)[6].fromClipped).toBeUndefined();
  });

  test('a hold the first rows begin at the same place may have begun before them', () => {
    // As the walk home, but the first rows are already at the door: the
    // tracker never saw the dog arrive, and the history may hold it there from
    // long before (2026-10-15, CardIndoorColdStart.test.js).
    const store = createHoldStore();
    const rows = walkHome(NOW - 60 * MINUTE, NOW - 50 * MINUTE)
      .map(row => ({ ...row, latitude: HOME.latitude }));
    for (let time = NOW - 50 * MINUTE + 30000; time <= NOW; time += 30000) {
      rows.push({ slave_id: 6, master_id: 7, time, latitude: 0, longitude: 0, satellites: 0, hdop: 655.35, source: 'ble' });
    }
    store.ingest({ rows });
    expect(store.holds(NOW)[6].fromClipped).toBe(true);
    expect(store.holds(NOW)[6].from).toBeGreaterThan(NOW - 50 * MINUTE);
    // Rows for longer than a cold start's replay before it: the tracker had
    // the time to see the dog arrive, it starts its own stay.
    const later = createHoldStore();
    const long = walkHome(NOW - 100 * MINUTE, NOW - 50 * MINUTE).map(row => ({ ...row, latitude: HOME.latitude }));
    later.ingest({ rows: [...long, ...rows.filter(row => row.time > NOW - 50 * MINUTE)] });
    expect(later.holds(NOW)[6].fromClipped).toBeUndefined();
  });

  test('a late row replaying a long hold keeps where it began', () => {
    const store = createHoldStore(HOLD_CONFIG, { classify: () => null });
    const rows = [];
    const start = NOW - 8 * 60 * MINUTE;
    rows.push(...walkHome(start, start + 5 * MINUTE));
    for (let time = start + 5 * MINUTE + 30000; time <= NOW; time += 60000) {
      rows.push({ slave_id: 6, master_id: 7, time, latitude: 0, longitude: 0, satellites: 0, hdop: 655.35, source: 'ble' });
    }
    store.ingest({ rows });
    const before = store.holds(NOW)[6];
    expect(before.fromClipped).toBeUndefined();
    // The window keeps six hours of a hold; a late cloud copy replays it.
    store.ingest({ rows: [{ slave_id: 6, master_id: 9, time: NOW - 20 * MINUTE + 5000, latitude: 0, longitude: 0,
      satellites: 0, hdop: 655.35, source: 'cloud' }] });
    const after = store.holds(NOW)[6];
    expect(after.from).toBe(before.from);
    expect(after.fromClipped).toBeUndefined();
  });
});

describe('a hold the live rows cannot start', () => {
  async function drifting() {
    const db = createMemoryConnection();
    await createDogDatabase(db).initialize();
    const insert = (time, lat, lon, sats, hdop) => db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
      received_at,slave_lat,slave_lon,satellites,hdop,battery_percentage,battery_valid) VALUES(7,8,?,?,?,?,?,80,1)`,
    [time, lat, lon, sats, hdop]);
    for (let time = INSIDE - 10 * MINUTE; time <= INSIDE; time += 30000) await insert(time, HOME.latitude, HOME.longitude, 9, 0.9);
    let i = 0;
    for (let time = INSIDE + 30000; time <= NOW; time += 30000, i += 1) {
      const jitter = ((i * 37) % 11 - 5) * 0.00002;
      const north = time < INSIDE + 30 * MINUTE ? 0.0002 : 0.0011;
      await insert(time, HOME.latitude + north + jitter, HOME.longitude + jitter, 3, 4.5);
    }
    return db;
  }
  let renderer;
  afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

  test('the map and the card hold the dog where and since the history does', async () => {
    const db = await drifting();
    try {
      const cloud = createCloudDatabase(db);
      await cloud.initialize();
      const store = createHoldStore();
      store.ingest(await cloud.holdRows(null, NOW - HOLD_LOOKBACK_MS, null));
      const holds = store.holds(NOW);
      // The live tracker alone: not held.
      expect(holds[8]).toBeUndefined();
      const candidates = historyHoldCandidates(store.statuses(), holds);
      expect(candidates).toEqual([{ slaveId: 8, at: NOW }]);
      const history = createHistoryDatabase(db);
      const read = jest.fn(request => history.historyDayRows(request));
      const seen = [];
      function Probe({ list }) { seen.push(useHistoryHolds(read, list, { owner: null })); return null; }
      await act(async () => { renderer = Renderer.create(<Probe list={candidates} />); });
      // The day's replay yields to the JS thread between steps (historyStayAtSoon).
      for (let i = 0; i < 200 && !seen.at(-1)[8]; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      const found = seen.at(-1)[8];
      // The same answer as in one go.
      const answer = await history.historyDayRows({ subject: 'dog', slaveId: 8, start: NOW - CARD_INDOOR_LOOKBACK_MS, end: NOW + 1, owner: null });
      const options = { at: NOW, readFrom: NOW - CARD_INDOOR_LOOKBACK_MS - HISTORY_DAY_CONTEXT_MS };
      expect(await historyStayAtSoon(answer, options)).toEqual(historyStayAt(answer, options));
      expect(found).toMatchObject({ coordinate: HOME, source: 'good', from: INSIDE + 30000 });
      expect(found.fromClipped).toBeUndefined();
      // A newer packet a moment later does not read the day again.
      await act(async () => renderer.update(<Probe list={[{ slaveId: 8, at: NOW + 30000 }]} />));
      expect(read).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)[8]).toBe(found);
      const packet = { slave_id: 8, master_id: 7, received_at: NOW, slave_lat: HOME.latitude + 0.0011,
        slave_lon: HOME.longitude, satellites: 3, hdop: 4.5, battery_percentage: 80, battery_valid: 1, source: 'ble' };
      const dog = mergeDogMarkers({ packetRows: [packet], holds: { ...seen.at(-1), ...holds }, now: NOW, windowMs: 180000 })[0];
      expect(dog).toMatchObject({ coordinate: HOME, heldFrom: INSIDE + 30000 });
      expect(position(dog)).toBe('室內');
    } finally { db.close(); }
  });

  test('only a dog not held with no trusted good fix in its rows is asked about', () => {
    const statuses = {
      4: { lastGoodAt: NOW - 60 * MINUTE, rowsFrom: NOW - 30 * MINUTE, newestAt: NOW },
      6: { lastGoodAt: NOW - 5 * MINUTE, rowsFrom: NOW - 30 * MINUTE, newestAt: NOW },
      8: { lastGoodAt: null, rowsFrom: NOW - 30 * MINUTE, newestAt: NOW - MINUTE },
      9: { lastGoodAt: NOW - 60 * MINUTE, rowsFrom: NOW - 30 * MINUTE, newestAt: NOW },
      10: { lastGoodAt: null, rowsFrom: null, newestAt: null },
    };
    expect(historyHoldCandidates(statuses, { 9: { coordinate: HOME } }))
      .toEqual([{ slaveId: 4, at: NOW }, { slaveId: 8, at: NOW - MINUTE }]);
  });
});
