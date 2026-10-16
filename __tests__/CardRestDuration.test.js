// 2026-10-16: every dog's card said 「休息中・超過 6 小時」. A real rest is
// followed back to where it began (「已 8 小時 12 分」); one past a day says
// 「超過 24 小時」; readings the collar marked invalid are no rest at all.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useDogCardReadings } from '../src/map/useDogCardReadings';
import { activityRow } from '../src/map/DogCardModel';
import { dogCardReadings, readDogCardRows } from '../src/activity/DogCardReadings';
import { createAtomicDogCardReader } from '../src/map/AtomicDogCardReader';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const NOW = new Date(2026, 9, 7, 9, 30, 0).getTime();

// One reading every 10 s for dog 4: `value(time)` (null: no reading).
const series = (from, until, value, valid = 1) => {
  const rows = [];
  for (let time = from; time < until; time += 10000) {
    const activity = value(time);
    if (activity != null) rows.push({ time, activity, activity_valid: valid, activity_time: null, master_id: 7, slave_id: 4 });
  }
  return rows;
};

// What the card's reader answers over these rows (CloudDatabase.dogCardRows' shape).
const reader = rows => jest.fn(async (slaveId, since, until = null) => ({
  local: rows.filter(row => row.time >= since && (until == null || row.time < until) && row.activity_valid === 1),
  cloud: [], battery: [], since, ...(until == null ? {} : { until }),
}));

async function cardRow(read) {
  const seen = [];
  function Probe() {
    seen.push(useDogCardReadings(read, 4, NOW));
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe />); });
  // Each older read is one more round.
  for (let round = 0; round < 6; round += 1) await act(async () => {});
  const row = readings => activityRow(readings.activity, { reference: NOW, positionAt: NOW, stale: false });
  await act(async () => renderer.unmount());
  return { last: row(seen.at(-1)), all: seen.filter(item => item.loaded).map(row) };
}

test('a rest of 8 hours 12 minutes says so, not 「超過 6 小時」', async () => {
  const restFrom = NOW - (8 * HOUR + 12 * MINUTE);
  const read = reader(series(NOW - 10 * HOUR, NOW, time => (time < restFrom ? 0.5 : 0.02)));
  const { last, all } = await cardRow(read);
  expect(last).toMatchObject({ word: '休息中', detail: '已 8 小時 12 分' });
  // While the older rows are read: 「休息中」 alone, never a number that changes.
  expect(all.map(item => item.detail).filter(Boolean)).toEqual(['已 8 小時 12 分']);
  // The six hours, then one step further back (6 h before them).
  expect(read.mock.calls.map(([, since, until]) => [(NOW - since) / HOUR, until == null ? null : (NOW - until) / HOUR]))
    .toEqual([[6, null], [12, 6]]);
});

test('a rest that reaches back past a day says 「超過 24 小時」, read back no further', async () => {
  const read = reader(series(NOW - 30 * HOUR, NOW, () => 0.01));
  const { last } = await cardRow(read);
  expect(last).toMatchObject({ word: '休息中', detail: '超過 24 小時' });
  expect(Math.min(...read.mock.calls.map(([, since]) => since))).toBe(NOW - 24 * HOUR);
});

test('a rest within the six hours reads nothing older', async () => {
  const read = reader(series(NOW - 6 * HOUR, NOW, time => (time < NOW - 2 * HOUR ? 0.5 : 0.02)));
  const { last } = await cardRow(read);
  expect(last).toMatchObject({ word: '休息中', detail: '已 2 小時' });
  expect(read).toHaveBeenCalledTimes(1);
});

test('the collar\'s invalid readings (activity 0, activity_valid 0) are no rest: 「—」', async () => {
  const rows = series(NOW - 8 * HOUR, NOW, () => 0, 0);
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    for (const row of rows) {
      await db.executeAsync(`INSERT INTO dog_status(master_id, slave_id, received_at, activity, activity_valid)
        VALUES(7, 4, ?, 0, 0)`, [row.time]);
    }
    const read = (slaveId, since, until) => readDogCardRows(db, null, slaveId, since, until);
    const { last } = await cardRow(read);
    expect(last).toMatchObject({ word: '—', detail: null });
    // The same rows marked valid are a rest (what the firmware would have to send).
    expect(dogCardReadings({ local: rows.map(row => ({ ...row, activity_valid: 1 })) }, NOW).activity.minutes.length)
      .toBeGreaterThan(0);
  } finally { db.close(); }
});

test('older rows from SQLite: only the activity rows before `until`', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    for (const ago of [9, 7, 5]) {
      await db.executeAsync(`INSERT INTO dog_status(master_id, slave_id, received_at, activity, activity_valid)
        VALUES(7, 4, ?, 0.02, 1)`, [NOW - ago * HOUR]);
    }
    const older = await readDogCardRows(db, null, 4, NOW - 12 * HOUR, NOW - 6 * HOUR);
    expect(older.local.map(row => (NOW - row.time) / HOUR)).toEqual([9, 7]);
    expect(older.battery).toEqual([]);
  } finally { db.close(); }
});

test('while a download publishes, older rows are not read from this phone alone', async () => {
  const database = { dogCardRows: jest.fn(async () => ({ local: [{ time: 1 }], cloud: [{ time: 2 }], battery: [] })) };
  const card = createAtomicDogCardReader(database, 'owner-1');
  card.update(true, 1);
  expect(await card.read(4, NOW - 12 * HOUR, NOW - 6 * HOUR)).toBeNull();
  expect(database.dogCardRows).not.toHaveBeenCalled();
  card.update(false, 2);
  expect(await card.read(4, NOW - 12 * HOUR, NOW - 6 * HOUR))
    .toMatchObject({ local: [{ time: 1 }], cloud: [{ time: 2 }] });
  expect(database.dogCardRows).toHaveBeenCalledWith('owner-1', 4, NOW - 12 * HOUR, NOW - 6 * HOUR);
});
