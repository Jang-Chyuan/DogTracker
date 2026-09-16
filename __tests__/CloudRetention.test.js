import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

test('keeps the newest 15000 globally on upgrade and writes without changing sync progress or BLE', async () => {
  const connection = createMemoryConnection();
  const cloud = createCloudDatabase(connection);
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
