import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { activityDetail, activityViewInput, mergeMinutes, readActivityEarliest,
  readActivityPeriod } from '../src/activity/ActivityData';
import { buildDayView } from '../src/activity/views';

const M = 60000;
const DAY = new Date(2026, 9, 6).getTime();

function database() {
  const db = createMemoryConnection();
  db.sqlite.exec(`CREATE TABLE dog_status(slave_id INTEGER, master_id INTEGER, received_at INTEGER, activity TEXT,
      activity_valid INTEGER, activity_time TEXT);
    CREATE TABLE supabase_dog_status(owner_user_id TEXT, slave_id INTEGER, master_id INTEGER, received_at INTEGER,
      track_at INTEGER, activity REAL, activity_valid INTEGER, activity_time TEXT);`);
  const local = (time, activity, valid = 1, slave = 6) => db.sqlite.prepare(
    'INSERT INTO dog_status VALUES(?,?,?,?,?,NULL)').run(slave, 7, time, String(activity), valid);
  const cloud = (time, activity, owner = 'a') => db.sqlite.prepare(
    'INSERT INTO supabase_dog_status VALUES(?,?,?,?,?,?,?,NULL)').run(owner, 6, 9, time + 5000, time, activity, 1);
  return { db, local, cloud };
}

test('日 reads raw rows of both tables with 9 minutes either side; other accounts and dogs stay out', async () => {
  const { db, local, cloud } = database();
  try {
    local(DAY - 9 * M, 0.02);
    local(DAY - 10 * M, 0.02); // outside the context
    local(DAY + 5 * M + 1000, 0.4);
    local(DAY + 5 * M + 2000, 0.9, 0); // not a valid reading
    local(DAY + 6 * M, 0.4, 1, 4); // another dog
    cloud(DAY + 7 * M, 0.6);
    cloud(DAY + 8 * M, 0.7, 'b'); // another account
    const answer = await readActivityPeriod(db, 'a', 6, { start: DAY, end: DAY + 1440 * M, detail: 'raw' });
    expect(answer.local.map(row => row.time)).toEqual([DAY - 9 * M, DAY + 5 * M + 1000]);
    expect(answer.cloud.map(row => row.time)).toEqual([DAY + 7 * M]);
    const signedOut = await readActivityPeriod(db, null, 6, { start: DAY, end: DAY + 1440 * M, detail: 'raw' });
    expect(signedOut.cloud).toEqual([]);
    const view = buildDayView({ date: DAY, now: DAY + 2 * 1440 * M, earliest: DAY, ...activityViewInput(answer) });
    expect(view.points[5]).toMatchObject({ value: 0.4, state: 'normal' });
    expect(view.points[7]).toMatchObject({ value: 0.6, state: 'normal' });
  } finally { db.close(); }
});

test('週／月／年: one mean per minute over both tables, a downloaded copy of this phone\'s reading once', async () => {
  const { db, local, cloud } = database();
  const stamped = (table, values) => db.sqlite.prepare(table === 'local'
    ? 'INSERT INTO dog_status VALUES(6,?,?,?,1,?)'
    : "INSERT INTO supabase_dog_status VALUES('a',6,?,?,?,?,1,?)").run(...values);
  try {
    local(DAY + 1000, 0.2);
    local(DAY + 2000, 0.4);
    cloud(DAY + 2000, 0.4); // the copy of this phone's upload (same time): once
    cloud(DAY + 3000, 0.9); // a reading only the cloud has: counts
    cloud(DAY + M, 0.5);
    stamped('local', [7, DAY + 2 * M + 1000, '0.1', 'A1']);
    stamped('cloud', [7, DAY + 2 * M + 9000, DAY + 2 * M + 1500, 0.1, 'A1']); // same collar stamp: once
    stamped('cloud', [8, DAY + 2 * M + 9000, DAY + 2 * M + 1500, 0.7, 'A1']); // other receiver: counts
    const answer = await readActivityPeriod(db, 'a', 6, { start: DAY, end: DAY + 1440 * M, detail: 'minute' });
    expect(answer.minutes).toEqual([
      { minute: DAY, value: expect.closeTo(0.5), count: 3 },
      { minute: DAY + M, value: 0.5, count: 1 },
      { minute: DAY + 2 * M, value: expect.closeTo(0.4), count: 2 },
    ]);
    expect(activityViewInput(answer)).toEqual({ minutes: answer.minutes });
    // The same minutes as the day's raw read through activityMinutes (the card's).
    const raw = await readActivityPeriod(db, 'a', 6, { start: DAY, end: DAY + 1440 * M, detail: 'raw' });
    const { activityMinutes } = require('../src/activity/ActivityMinutes');
    const same = activityMinutes(activityViewInput(raw).readings, { now: DAY + 1440 * M });
    expect(same.map(item => [item.minute, item.count])).toEqual(answer.minutes.map(item => [item.minute, item.count]));
    same.forEach((item, i) => expect(item.value).toBeCloseTo(answer.minutes[i].value));
  } finally { db.close(); }
});

test('the first reading of either table, null without any; bad input rejected', async () => {
  const { db, local, cloud } = database();
  try {
    expect(await readActivityEarliest(db, 'a', 6)).toBeNull();
    local(DAY + 5 * M, 0.2);
    cloud(DAY + 2 * M, 0.2);
    expect(await readActivityEarliest(db, 'a', 6)).toBe(DAY + 2 * M);
    expect(await readActivityEarliest(db, null, 6)).toBe(DAY + 5 * M);
    await expect(readActivityPeriod(db, 'a', 0, { start: DAY, end: DAY + M })).rejects.toThrow('活動量查詢條件無效');
    await expect(readActivityPeriod(db, 'a', 6, { start: DAY, end: DAY })).rejects.toThrow('活動量查詢條件無效');
  } finally { db.close(); }
});

test('detail by tab and merging minutes', () => {
  expect(activityDetail('day')).toBe('raw');
  expect(['week', 'month', 'year'].map(activityDetail)).toEqual(['minute', 'minute', 'minute']);
  expect(mergeMinutes([{ minute: 2, sum: 0.3, count: 3 }], [{ minute: 2, sum: 0.9, count: 1 },
    { minute: 1, sum: 0.5, count: 1 }, { minute: 'x', sum: 1, count: 1 }, { minute: 3, sum: 0, count: 0 }]))
    .toEqual([{ minute: 1, value: 0.5, count: 1 }, { minute: 2, value: expect.closeTo(0.3), count: 4 }]);
});

test('CloudDatabase answers the page over the real schema', async () => {
  const { createDogDatabase } = require('../src/database/DogDatabase');
  const { createCloudDatabase, CLOUD_DATABASE_METHODS } = require('../src/cloud/CloudDatabase');
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    expect(CLOUD_DATABASE_METHODS).toEqual(expect.arrayContaining(['activityPeriod', 'activityEarliest']));
    await connection.executeAsync(`INSERT INTO dog_status(received_at, slave_id, master_id, activity, activity_valid)
      VALUES(?,?,?,?,?)`, [DAY + 30000, 6, 7, '0.02', 1]);
    const raw = await cloud.activityPeriod('a', 6, { start: DAY, end: DAY + 1440 * M, detail: 'raw' });
    expect(raw.local).toHaveLength(1);
    const minutes = await cloud.activityPeriod('a', 6, { start: DAY, end: DAY + 1440 * M, detail: 'minute' });
    expect(minutes.minutes).toEqual([{ minute: DAY, value: expect.closeTo(0.02), count: 1 }]);
    expect(await cloud.activityEarliest('a', 6)).toBe(DAY + 30000);
  } finally { connection.close(); }
});
