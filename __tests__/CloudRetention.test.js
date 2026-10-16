import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { withCloudSyncSlot } from '../src/cloud/CloudSyncSlot';
import { CLOUD_BUDGET_BYTES, CLOUD_MAX_ROWS, CLOUD_PAYLOAD_MS, TRIM_DELAY_MS, TRIM_PAUSE_MS,
  createCloudDatabase } from '../src/cloud/CloudDatabase';

// The real cap is half a million rows, so the mechanism is checked with a small
// one; the default is asserted separately below.
test('keeps the newest rows globally on upgrade and writes without changing sync progress or BLE', async () => {
  const connection = createMemoryConnection();
  const cloud = createCloudDatabase(connection, { maxRows: 15000 });
  const sql = connection.sqlite;
  try {
    await createDogDatabase(connection).initialize();
    await cloud.initialize();
    sql.exec('BEGIN');
    const insert = sql.prepare(`INSERT INTO supabase_dog_status
      (received_at, owner_user_id, event_id, master_id) VALUES (?, ?, ?, ?)`);
    for (let i = 1; i <= 15002; i += 1) insert.run(i, i % 2 ? 'a' : 'b', String(i), i % 2 ? 5 : 7);
    sql.exec('COMMIT');
    sql.exec('INSERT INTO dog_status(received_at) VALUES (1)');
    // Simulate reopening a pre-upgrade database, not a sync tick: the start
    // no longer trims (it held the write lock for seconds); the next page does.
    await createCloudDatabase({ ...connection }, { maxRows: 15000 }).initialize();
    const summary = () => sql.prepare(`SELECT COUNT(*) AS count, MIN(received_at) AS oldest
      FROM supabase_dog_status`).get();
    expect(summary()).toMatchObject({ count: 15002, oldest: 1 });
    const record = { event_id: 'new', received_at: 20000, activity_valid: 0, battery_valid: 0 };
    const checkpoint = { masterId: 7, throughAt: '2026-09-17T12:00:00Z', eventId: 'new' };
    await cloud.savePage('a', [record], checkpoint);
    expect(summary()).toMatchObject({ count: 15000, oldest: 4 });
    await cloud.savePage('a', [{ ...record, event_id: 'old-manual', received_at: 1 }]);
    expect(summary()).toMatchObject({ count: 15000, oldest: 4 });
    expect(sql.prepare("SELECT id FROM supabase_dog_status WHERE event_id = 'old-manual'").get()).toBeUndefined();
    // Equal reception times use the local id as a deterministic tiebreaker.
    await cloud.savePage('b', [{ ...record, event_id: 'tie', received_at: 4 }]);
    expect(sql.prepare("SELECT id FROM supabase_dog_status WHERE event_id = '4'").get()).toBeUndefined();
    expect(await cloud.loadSyncState('a', 7)).toMatchObject({ through_at: checkpoint.throughAt, event_id: 'new' });
    expect(sql.prepare('SELECT COUNT(*) AS count FROM dog_status').get().count).toBe(1);
    // A retention failure rolls back inserts and progress in the same transaction.
    sql.exec("CREATE TRIGGER deny_trim BEFORE DELETE ON supabase_dog_status BEGIN SELECT RAISE(ABORT, 'trim failed'); END");
    await expect(cloud.savePage('a', [{ ...record, event_id: 'rollback' }],
      { ...checkpoint, eventId: 'rollback' })).rejects.toThrow();
    expect(await cloud.loadSyncState('a', 7)).toMatchObject({ event_id: 'new' });
    expect(sql.prepare("SELECT id FROM supabase_dog_status WHERE event_id = 'rollback'").get()).toBeUndefined();
    expect(summary().count).toBe(15000);
  } finally { connection.close(); }
});

test('the cap is a size budget, and the original JSON only outlives a day', async () => {
  jest.useFakeTimers();
  const connection = createMemoryConnection();
  const sql = connection.sqlite;
  try {
    await createDogDatabase(connection).initialize();
    // 500 MB at the measured 560 bytes a row. The old cap was 15,000 rows for
    // every account together: about one day for a single dog, so a day someone
    // downloaded on purpose was gone by the next morning.
    expect(CLOUD_MAX_ROWS).toBe(Math.floor(CLOUD_BUDGET_BYTES / 560));
    expect(CLOUD_MAX_ROWS).toBeGreaterThan(900000);
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    const now = Date.now();
    const insert = sql.prepare(`INSERT INTO supabase_dog_status
      (received_at, owner_user_id, event_id, master_id, slave_id, raw_payload)
      VALUES (?, 'a', ?, 7, 4, '{"lat":1}')`);
    insert.run(now - 2 * CLOUD_PAYLOAD_MS, 'old');
    insert.run(now - 60000, 'fresh');
    // The sweep runs a while after open (in the background, PAYLOAD_BATCH
    // rows a statement) and then every twentieth page.
    await createCloudDatabase({ ...connection }).initialize();
    const payload = event => sql.prepare(
      'SELECT raw_payload FROM supabase_dog_status WHERE event_id = ?').get(event).raw_payload;
    expect(payload('old')).toBe('{"lat":1}');
    await jest.advanceTimersByTimeAsync(TRIM_DELAY_MS + 10 * TRIM_PAUSE_MS);
    expect(payload('old')).toBeNull();
    expect(payload('fresh')).toBe('{"lat":1}');
    // Nothing is evicted while the phone is nowhere near the budget.
    const usage = await cloud.usage();
    expect(usage).toMatchObject({ rows: 2, budget: CLOUD_BUDGET_BYTES });
    expect(usage.bytes).toBe(2 * 560);
  } finally { connection.close(); jest.useRealTimers(); }
});

test('after start, a table over the cap is brought to it in the background, 500 rows a transaction', async () => {
  jest.useFakeTimers();
  const connection = createMemoryConnection();
  const sql = connection.sqlite;
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection, { maxRows: 1000 });
    await cloud.initialize();
    // The counter exists (a page downloaded since the update), and the table is 1,700 over the cap.
    sql.exec('INSERT INTO cloud_row_count(id, n) VALUES (1, 0)');
    const insert = sql.prepare('INSERT INTO supabase_dog_status (received_at, owner_user_id, event_id, master_id) VALUES (?, ?, ?, 5)');
    sql.exec('BEGIN');
    for (let i = 1; i <= 2700; i += 1) insert.run(i, 'a', String(i));
    sql.exec('COMMIT');
    const batches = [];
    const run = connection.executeBatchAsync.getMockImplementation();
    connection.executeBatchAsync.mockImplementation(commands => { batches.push(commands.map(c => c.query)); return run(commands); });
    // Opened again (the start): nothing deleted then.
    await createCloudDatabase({ ...connection }, { maxRows: 1000 }).initialize();
    expect(sql.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(2700);
    await jest.advanceTimersByTimeAsync(TRIM_DELAY_MS + 10 * TRIM_PAUSE_MS);
    expect(sql.prepare('SELECT COUNT(*) AS n, MIN(received_at) AS oldest FROM supabase_dog_status').get()).toEqual({ n: 1000, oldest: 1701 });
    expect(sql.prepare('SELECT n FROM cloud_row_count').get().n).toBe(1000);
    const trims = batches.filter(queries => queries.some(q => q.startsWith('DELETE FROM supabase_dog_status WHERE id IN')));
    expect(trims).toHaveLength(4); // 500, 500, 500, 200
    // Each statement starts at the oldest row: no OFFSET walk of the rows kept.
    const plan = sql.prepare(`EXPLAIN QUERY PLAN SELECT id FROM supabase_dog_status ORDER BY received_at, id LIMIT 500`).all()
      .map(row => row.detail).join(' | ');
    expect(plan).toMatch(/SCAN supabase_dog_status USING (COVERING )?INDEX idx_supabase_dog_status_received_at_id/);
    expect(trims.flat().some(q => /OFFSET/.test(q))).toBe(false);
  } finally { connection.close(); jest.useRealTimers(); }
});

test('review: the background trim waits for a download job holding the cloud sync slot', async () => {
  jest.useFakeTimers();
  const connection = createMemoryConnection();
  const sql = connection.sqlite;
  let release;
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection, { maxRows: 100 });
    await cloud.initialize();
    sql.exec('INSERT INTO cloud_row_count(id, n) VALUES (1, 0)');
    const insert = sql.prepare('INSERT INTO supabase_dog_status (received_at, owner_user_id, event_id, master_id) VALUES (?, ?, ?, 5)');
    for (let i = 1; i <= 300; i += 1) insert.run(i, 'a', String(i));
    // A manual download is between its begin and its publish.
    const job = withCloudSyncSlot(() => new Promise(resolve => { release = resolve; }));
    await createCloudDatabase({ ...connection }, { maxRows: 100 }).initialize();
    await jest.advanceTimersByTimeAsync(TRIM_DELAY_MS + 50 * TRIM_PAUSE_MS);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(300);
    release();
    await job;
    await jest.advanceTimersByTimeAsync(50 * TRIM_PAUSE_MS);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(100);
  } finally { release?.(); connection.close(); jest.useRealTimers(); }
});

test('review: maintenance started by a headless wrapper that closed is started again by the next one', async () => {
  jest.useFakeTimers();
  const connection = createMemoryConnection();
  const sql = connection.sqlite;
  try {
    connection.lockKey = {};
    await createDogDatabase(connection).initialize();
    // The headless sync's wrapper: same native owner (lock key), closed when its sync ends.
    let closed = false;
    const headless = { ...connection,
      executeAsync: (...args) => (closed ? Promise.reject(new Error('closed')) : connection.executeAsync(...args)),
      executeBatchAsync: (...args) => (closed ? Promise.reject(new Error('closed')) : connection.executeBatchAsync(...args)) };
    await createCloudDatabase(headless).initialize();
    sql.prepare(`INSERT INTO supabase_dog_status (received_at, owner_user_id, event_id, master_id, raw_payload)
      VALUES (?, 'a', 'old', 5, '{}')`).run(Date.now() - 2 * CLOUD_PAYLOAD_MS);
    closed = true;
    await jest.advanceTimersByTimeAsync(TRIM_DELAY_MS + 10 * TRIM_PAUSE_MS);
    // The App's own wrapper opens the database: the work starts again with it.
    await createCloudDatabase({ ...connection }).initialize();
    await jest.advanceTimersByTimeAsync(TRIM_DELAY_MS + 10 * TRIM_PAUSE_MS);
    expect(sql.prepare("SELECT raw_payload FROM supabase_dog_status WHERE event_id = 'old'").get().raw_payload).toBeNull();
  } finally { connection.close(); jest.useRealTimers(); }
});
