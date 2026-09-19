import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { CLOUD_BUDGET_BYTES, CLOUD_MAX_ROWS, CLOUD_PAYLOAD_MS,
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
    await cloud.initialize();
    const summary = () => sql.prepare(`SELECT COUNT(*) AS count, MIN(received_at) AS oldest
      FROM supabase_dog_status`).get();
    expect(summary()).toMatchObject({ count: 15000, oldest: 3 });
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
    // The sweep runs on open and then every twentieth page.
    await cloud.initialize();
    const payload = event => sql.prepare(
      'SELECT raw_payload FROM supabase_dog_status WHERE event_id = ?').get(event).raw_payload;
    expect(payload('old')).toBeNull();
    expect(payload('fresh')).toBe('{"lat":1}');
    // Nothing is evicted while the phone is nowhere near the budget.
    const usage = await cloud.usage();
    expect(usage).toMatchObject({ rows: 2, budget: CLOUD_BUDGET_BYTES });
    expect(usage.bytes).toBe(2 * 560);
  } finally { connection.close(); }
});
