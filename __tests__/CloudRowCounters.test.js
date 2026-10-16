/* eslint-env node */
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createDogDataStore } from '../src/database/DogDataStore';
import { CLOUD_ROWS, backfillWifiStep, cloudRowCountInit, cloudRowSetup, wifiLatestReady, WIFI_BACKFILL_IDS } from '../src/cloud/CloudRowCounters';

// 2026-10-16: with about 940,000 downloaded rows, the cap check's COUNT(*)
// (1.1–1.8 s inside every download page's write transaction) and
// wifiUploads' GROUP BY (2.6–38 s) held the App's database queue a dog's
// history waited behind. Both answers are now kept by triggers.
async function cloudDatabase() {
  const db = createMemoryConnection();
  await createDogDatabase(db).initialize();
  const cloud = createCloudDatabase(db);
  await cloud.initialize();
  const insert = db.sqlite.prepare(`INSERT INTO supabase_dog_status (owner_user_id, event_id, received_at, master_id, slave_id, upload_source)
    VALUES (?, ?, ?, ?, ?, ?)`);
  let n = 0;
  const add = (owner, at, master, source) => { n += 1; insert.run(owner, `e${n}`, at, master, 1, source); };
  const count = () => db.sqlite.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n;
  const counter = () => db.sqlite.prepare('SELECT n FROM cloud_row_count WHERE id = 1').get()?.n ?? null;
  const oldWifi = owner => Object.fromEntries(db.sqlite.prepare(`SELECT master_id, MAX(received_at) AS time FROM supabase_dog_status
    WHERE owner_user_id = ? AND upload_source = 'wifi' GROUP BY master_id`).all(owner).map(row => [row.master_id, row.time]));
  return { db, cloud, add, count, counter, oldWifi };
}

test('the row counter: counted once, then exact through inserts, deletes and 刪除全部狗資料', async () => {
  const { db, cloud, add, count, counter } = await cloudDatabase();
  try {
    for (let i = 0; i < 500; i += 1) add('a', 1000 + i, 3, 'wifi');
    // No counter before the first download page after the update: the old count answers.
    expect(counter()).toBeNull();
    expect(db.sqlite.prepare(`SELECT ${CLOUD_ROWS} AS n`).get().n).toBe(500);
    await db.executeBatchAsync(await cloudRowCountInit(db));
    expect(counter()).toBe(500);
    // With the counter there: nothing to run, and the counter answers.
    expect(await cloudRowCountInit(db)).toEqual([]);
    db.sqlite.prepare('UPDATE cloud_row_count SET n = 777 WHERE id = 1').run();
    expect(db.sqlite.prepare(`SELECT ${CLOUD_ROWS} AS n`).get().n).toBe(777);
    db.sqlite.prepare('UPDATE cloud_row_count SET n = 500 WHERE id = 1').run();
    for (let i = 0; i < 120; i += 1) add('b', 5000 + i, 4, 'phone');
    db.sqlite.exec("DELETE FROM supabase_dog_status WHERE received_at < 1100");
    db.sqlite.exec("INSERT OR IGNORE INTO supabase_dog_status (owner_user_id, event_id, received_at) VALUES ('a', 'e200', 1)");
    expect(counter()).toBe(count());
    expect(count()).toBe(520);
    // The cloud page's usage reads the counter.
    expect((await cloud.usage()).rows).toBe(520);
    await createDogDataStore(db).deleteAll({ includeUnsent: true });
    expect(count()).toBe(0);
    expect(counter()).toBe(0);
    add('a', 9000, 3, 'wifi');
    expect(counter()).toBe(1);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE type = \'trigger\' AND name LIKE \'cloud_rows_%\'').get().n).toBe(4);
  } finally { db.close(); }
});

test('each Master\'s newest Wi-Fi row: rows stored before come in the background, then the same answer as the GROUP BY', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    // An older database: the rows were downloaded before the triggers existed.
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    db.sqlite.exec('DROP TRIGGER cloud_rows_inserted_v2; DROP TRIGGER cloud_rows_wifi_changed_v2; DROP TABLE cloud_wifi_backfill');
    const insert = db.sqlite.prepare(`INSERT INTO supabase_dog_status (owner_user_id, event_id, received_at, master_id, slave_id, upload_source)
      VALUES (?, ?, ?, ?, 1, ?)`);
    db.sqlite.exec('BEGIN');
    for (let i = 0; i < 2 * WIFI_BACKFILL_IDS + 10; i += 1)
      insert.run(i % 3 ? 'a' : 'b', `e${i}`, 1000 + i, 3 + (i % 4), i % 5 ? 'phone' : 'wifi');
    db.sqlite.exec('COMMIT');
    const old = owner => Object.fromEntries(db.sqlite.prepare(`SELECT master_id, MAX(received_at) AS time FROM supabase_dog_status
      WHERE owner_user_id = ? AND upload_source = 'wifi' GROUP BY master_id`).all(owner).map(row => [row.master_id, row.time]));
    const expected = old('a');
    // The update (CloudDatabase.initialize): triggers and the range still to add.
    await db.executeBatchAsync(cloudRowSetup());
    expect(await wifiLatestReady(db)).toBe(false);
    // A newer Wi-Fi row arrives (trigger) and an older one is deleted before the backfill.
    insert.run('a', 'late', 99999999, 4, 'wifi');
    db.sqlite.exec("DELETE FROM supabase_dog_status WHERE event_id = 'e5'");
    // One step by hand; the answer then waits for the rest (never a walk of the account's rows).
    expect(await backfillWifiStep(db)).toBe(true);
    const statements = [];
    const read = db.executeAsync.getMockImplementation();
    db.executeAsync.mockImplementation((sql, params) => { statements.push(sql); return read(sql, params); });
    const answer = await cloud.wifiUploads('a');
    expect(statements.some(sql => /GROUP BY master_id/.test(sql) && /FROM supabase_dog_status\s+WHERE owner_user_id/.test(sql))).toBe(false);
    expect(await wifiLatestReady(db)).toBe(true);
    const after = { ...expected, 4: 99999999 };
    expect(answer).toEqual(after);
    expect(await cloud.wifiUploads('a')).toEqual(after);
    expect(await cloud.wifiUploads('b')).toEqual(old('b'));
    // A row repaired to Wi-Fi later counts too.
    db.sqlite.exec("UPDATE supabase_dog_status SET upload_source = 'wifi', received_at = 199999999 WHERE event_id = 'e1'");
    expect((await cloud.wifiUploads('a'))[db.sqlite.prepare("SELECT master_id FROM supabase_dog_status WHERE event_id = 'e1'").get().master_id])
      .toBe(199999999);
    // The read itself: one primary-key range, not the account's rows.
    const plan = db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT master_id, received_at AS time FROM cloud_wifi_latest WHERE owner_user_id = 'a'")
      .all().map(row => row.detail).join(' | ');
    expect(plan).toMatch(/SEARCH cloud_wifi_latest USING (PRIMARY KEY|INDEX sqlite_autoindex)/);
  } finally { db.close(); }
});

// Codex review (2026-10-16) of the first version of these triggers.
test('review: an insert under OR IGNORE (the publication) still raises the Master\'s Wi-Fi time', async () => {
  const { db, cloud } = await cloudDatabase();
  try {
    const insert = db.sqlite.prepare(`INSERT OR IGNORE INTO supabase_dog_status (owner_user_id, event_id, received_at, master_id, slave_id, upload_source)
      VALUES ('a', ?, ?, 3, 1, 'wifi')`);
    insert.run('x1', 100);
    insert.run('x2', 200);
    insert.run('x1', 999); // the same event again: ignored, nothing raised
    expect(await cloud.wifiUploads('a')).toEqual({ 3: 200 });
  } finally { db.close(); }
});

test('review: a Wi-Fi row deleted before the backfill reached it keeps its time', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    db.sqlite.exec('DROP TRIGGER cloud_rows_inserted_v2; DROP TRIGGER cloud_rows_wifi_changed_v2; DROP TRIGGER cloud_rows_wifi_deleted_v2; DROP TABLE cloud_wifi_backfill');
    const insert = db.sqlite.prepare(`INSERT INTO supabase_dog_status (owner_user_id, event_id, received_at, master_id, slave_id, upload_source)
      VALUES ('a', ?, ?, 3, 1, 'wifi')`);
    insert.run('old-new', 200);
    insert.run('old-old', 100);
    await db.executeBatchAsync(cloudRowSetup());
    db.sqlite.exec("DELETE FROM supabase_dog_status WHERE event_id = 'old-new'");
    while (await backfillWifiStep(db));
    expect(await cloud.wifiUploads('a')).toEqual({ 3: 200 });
  } finally { db.close(); }
});

test('review: a table an older App emptied leaves no Wi-Fi time behind after the update', async () => {
  const { db, cloud, add } = await cloudDatabase();
  try {
    add('a', 100, 3, 'wifi');
    expect(await cloud.wifiUploads('a')).toEqual({ 3: 100 });
    // The older App's 刪除全部狗資料: the rows go (its DELETE fires these
    // triggers), and a later download of phone uploads brings nothing back.
    db.sqlite.exec('DELETE FROM supabase_dog_status');
    add('a', 300, 3, 'phone');
    await db.executeBatchAsync(cloudRowSetup());
    expect(await cloud.wifiUploads('a')).toEqual({});
    // An older database that never had the triggers: an empty table at the update.
    db.sqlite.exec("DROP TRIGGER cloud_rows_deleted_v2; INSERT INTO cloud_wifi_latest VALUES ('a', 3, 100); DELETE FROM supabase_dog_status");
    await db.executeBatchAsync(cloudRowSetup());
    expect(await cloud.wifiUploads('a')).toEqual({});
  } finally { db.close(); }
});

test('review: a failed backfill step gives no partial answer; the next call finishes it', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    db.sqlite.exec('DROP TRIGGER cloud_rows_inserted_v2; DROP TRIGGER cloud_rows_wifi_changed_v2; DROP TRIGGER cloud_rows_wifi_deleted_v2; DROP TABLE cloud_wifi_backfill');
    const insert = db.sqlite.prepare(`INSERT INTO supabase_dog_status (owner_user_id, event_id, received_at, master_id, slave_id, upload_source)
      VALUES ('a', ?, ?, 3, 1, ?)`);
    db.sqlite.exec('BEGIN');
    for (let i = 0; i < WIFI_BACKFILL_IDS + 5; i += 1) insert.run(`e${i}`, 100 + i, i === WIFI_BACKFILL_IDS + 2 ? 'wifi' : i === 0 ? 'wifi' : 'phone');
    db.sqlite.exec('COMMIT');
    await db.executeBatchAsync(cloudRowSetup());
    const batch = db.executeBatchAsync.getMockImplementation();
    let calls = 0;
    db.executeBatchAsync.mockImplementation(commands => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('disk I/O error'));
      return batch(commands);
    });
    await expect(cloud.wifiUploads('a')).rejects.toThrow('not ready');
    expect(await cloud.wifiUploads('a')).toEqual({ 3: 100 + WIFI_BACKFILL_IDS + 2 });
  } finally { db.close(); }
});
