import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createHoldStore } from '../src/placement/HoldStore';
import { HOLD_CONFIG } from '../src/placement/IndoorHold';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { dogCard } from '../src/map/DogCardModel';
import { CARD_INDOOR_LOOKBACK_MS, CARD_INDOOR_RETRY_MS, historyHoldCandidates, indoorStayStart, useCardIndoorStay,
  useHistoryHolds } from '../src/map/CardIndoorStay';
import { createHistoryDatabase, HISTORY_DAY_CONTEXT_MS } from '../src/mapHistory/HistoryDatabase';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { nodeTimes, nodePill } from '../src/history/HistoryText';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

// 2026-10-13 (dog 108 on the emulator): the card said 「室內・30 分」 while the
// history's day began 「00:00 接續前一天」 with the cursor at 「室內・11 時 2
// 分」: the live hold replays only the last half hour on a cold start, so the
// first row it holds is where that half hour begins. All data made up.
const MINUTE = 60000;
const NOW = new Date('2026-10-13T09:30:00+08:00').getTime();
const MIDNIGHT = new Date('2026-10-13T00:00:00+08:00').getTime();
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

const position = (dog, indoorStay) => dogCard(dog, { freshness: fresh, now: NOW, name: '小黑', indoorStay })
  .rows.find(row => row.key === 'position').value;

async function stayOf(db, at) {
  const start = at - CARD_INDOOR_LOOKBACK_MS;
  const answer = await createHistoryDatabase(db).historyDayRows({ slaveId: 6, start, end: at });
  return indoorStayStart(answer, { at, readFrom: start - HISTORY_DAY_CONTEXT_MS });
}

describe('a stay begun before the live rows', () => {
  test('the live hold knows only that it began before its half hour', async () => {
    const db = await kennel();
    try {
      const { hold, dog } = await coldStartDog(db);
      expect(hold.fromClipped).toBe(true);
      expect(dog.heldFromClipped).toBe(true);
      expect(dog.heldFrom).toBeGreaterThanOrEqual(NOW - HOLD_LOOKBACK_MS);
      // Before: 「室內・30 分」. Without the history it says only a lower bound.
      expect(position(dog, null)).toBe('室內・超過 30 分');
      // While the history is asked: no minutes rather than wrong ones.
      expect(position(dog, { state: 'pending' })).toBe('室內');
    } finally { db.close(); }
  });

  test('the card counts the whole stay from where the history begins it, over midnight too', async () => {
    const db = await kennel();
    try {
      const { dog } = await coldStartDog(db);
      const stay = await stayOf(db, dog.heldFrom);
      expect(stay).toEqual({ from: INSIDE + 30000, clipped: false });
      expect(position(dog, { state: 'found', ...stay })).toBe('室內・12 時 30 分');
      // The history: the evening's row starts at the same packet; today's row
      // starts at midnight 「接續前一天」 and runs on (the minutes of today only).
      // As useHistoryScreen: the day's rows through a hold pass seeded with
      // the good fixes before them.
      const day = async (start, end, options) => {
        const answer = await createHistoryDatabase(db).historyDayRows({ slaveId: 6, start, end });
        return historyTimeline(answer.rows, { ...options, holdOptions: { seed: answer.seed } });
      };
      const evening = await day(MIDNIGHT - 24 * 60 * MINUTE, MIDNIGHT, {
        dayStart: MIDNIGHT - 24 * 60 * MINUTE, dayEnd: MIDNIGHT });
      expect(evening.nodes.find(node => node.type === 'indoor').start).toBe(stay.from);
      const today = timelinePresentation((await day(MIDNIGHT, NOW, {
        dayStart: MIDNIGHT, dayEnd: MIDNIGHT + 24 * 60 * MINUTE, today: true, now: NOW })).nodes);
      expect(today[0].type).toBe('indoor');
      expect(nodeTimes(today[0])[0]).toBe('00:00');
      // 2026-10-15 (user): no 「接續前一天」 pill; the minutes from 00:00.
      expect(nodePill(today[0]).text).toMatch(/^室內・/u);
    } finally { db.close(); }
  });

  test('a stay older than the card looks back says how long at least', async () => {
    const db = await kennel({ from: NOW - 30 * 60 * MINUTE - 10 * MINUTE });
    try {
      // The kennel rows here begin 30 hours ago: inside from then on.
      await db.executeAsync('DELETE FROM dog_status WHERE received_at > ? AND received_at < ?',
        [NOW - 30 * 60 * MINUTE, INSIDE + 30000]);
      for (let time = NOW - 30 * 60 * MINUTE + 30000; time <= INSIDE; time += 30000) {
        await db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,received_at,slave_lat,slave_lon,satellites,hdop)
          VALUES(7,6,?,0,0,0,655.35)`, [time]);
      }
      const { dog } = await coldStartDog(db);
      const stay = await stayOf(db, dog.heldFrom);
      expect(stay.clipped).toBe(true);
      expect(position(dog, { state: 'found', ...stay })).toBe('室內・超過 25 時');
    } finally { db.close(); }
  });

  test('history that does not hold the dog there leaves the lower bound', () => {
    const at = NOW - 30 * MINUTE;
    // Clear fixes only: no 室內 node reaches `at`.
    const rows = [];
    for (let time = at - 20 * MINUTE; time <= at; time += 30000) {
      rows.push({ id: time, source: 'local', slave_id: 6, master_id: 7, time, packetTime: time, locationTime: time,
        latitude: HOME.latitude, longitude: HOME.longitude, satellites: 9, hdop: 0.9 });
    }
    expect(indoorStayStart({ rows }, { at })).toBeNull();
    const dog = { slaveId: 6, coordinate: HOME, heldReason: '室內', heldSource: 'good', heldFrom: at,
      heldFromClipped: true, packetAt: NOW };
    expect(position(dog, { state: 'unknown' })).toBe('室內・超過 30 分');
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

describe('useCardIndoorStay', () => {
  let renderer;
  afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
  const dog = { slaveId: 6, heldFrom: NOW - 30 * MINUTE, heldFromClipped: true };
  function Probe({ read, value, options, sink }) {
    sink.push(useCardIndoorStay(read, value, options));
    return null;
  }

  test('reads once per hold start, and not again after a download once found', async () => {
    const db = await kennel();
    try {
      const history = createHistoryDatabase(db);
      const read = jest.fn(request => history.historyDayRows(request));
      const seen = [];
      const at = (await coldStartDog(db)).dog.heldFrom;
      const value = { ...dog, heldFrom: at };
      await act(async () => {
        renderer = Renderer.create(<Probe read={read} value={value} options={{ revision: 1 }} sink={seen} />);
      });
      expect(seen[0]).toEqual({ state: 'pending' });
      expect(seen[seen.length - 1]).toEqual({ state: 'found', from: INSIDE + 30000, clipped: false });
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0][0]).toMatchObject({ subject: 'dog', slaveId: 6, start: at - CARD_INDOOR_LOOKBACK_MS, end: at });
      await act(async () => renderer.update(<Probe read={read} value={value} options={{ revision: 2 }} sink={seen} />));
      expect(read).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });

  test('nothing to ask for a hold the live rows saw begin, or while the download runs', async () => {
    const read = jest.fn(async () => ({ rows: [], seed: [] }));
    const seen = [];
    await act(async () => {
      renderer = Renderer.create(<Probe read={read} value={{ ...dog, heldFromClipped: false }} sink={seen} />);
    });
    expect(seen[seen.length - 1]).toBeNull();
    await act(async () => renderer.update(<Probe read={read} value={dog} options={{ busy: true }} sink={seen} />));
    expect(seen[seen.length - 1]).toEqual({ state: 'pending' });
    expect(read).not.toHaveBeenCalled();
    await act(async () => renderer.update(<Probe read={read} value={dog} options={{ busy: false }} sink={seen} />));
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toEqual({ state: 'unknown' });
  });

  test('a start not found is asked again after a download, at most every five minutes', async () => {
    const read = jest.fn(async () => ({ rows: [], seed: [] }));
    let clock = NOW;
    const options = revision => ({ revision, now: () => clock });
    await act(async () => {
      renderer = Renderer.create(<Probe read={read} value={dog} options={options(1)} sink={[]} />);
    });
    await act(async () => renderer.update(<Probe read={read} value={dog} options={options(2)} sink={[]} />));
    expect(read).toHaveBeenCalledTimes(1);
    clock += CARD_INDOOR_RETRY_MS;
    await act(async () => renderer.update(<Probe read={read} value={dog} options={options(3)} sink={[]} />));
    expect(read).toHaveBeenCalledTimes(2);
  });
});

// 2026-10-13 (dog 8 on the emulator): indoors 12+ hours by the history, but no
// 位置 row on the card and no 「室內」 on the map. Its drift settled about
// 120 m from the last good fix: the history, holding it since the evening,
// keeps the hold (it lets go beyond 150 m); a cold start sees only the last
// half hour and cannot start one (the weak fixes must lie within 100 m of the
// good ones). All data made up.
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
      await act(async () => {});
      const found = seen.at(-1)[8];
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
      expect(position(dog, null)).toBe('室內・12 時 30 分');
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
