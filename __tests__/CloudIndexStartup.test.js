import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase, latestCloudStatusQuery } from '../src/cloud/CloudDatabase';
import { withConnectionLock } from '../src/database/connectionLock';

const indexSql = sql => /^(?:DROP INDEX IF EXISTS|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS) idx_cloud_/.test(sql);

test('opening existing cloud indexes uses two native calls instead of eleven promise round trips', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    await createCloudDatabase(db).initialize();
    const schema = db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cloud_%' ORDER BY name").all();
    db.executeAsync.mockClear(); db.executeBatchAsync.mockClear();
    await createCloudDatabase({ ...db }).initialize();
    const individual = db.executeAsync.mock.calls.filter(([sql]) => indexSql(sql));
    const batches = db.executeBatchAsync.mock.calls.filter(([commands]) => commands.some(command => indexSql(command.query)));
    const lookups = db.executeAsync.mock.calls.filter(([sql]) => sql.startsWith("SELECT name FROM sqlite_master WHERE type='index' AND name IN"));
    expect(individual.length + batches.length + lookups.length).toBe(2);
    expect(db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cloud_%' ORDER BY name").all()).toEqual(schema);
    for (const fixed of [false, true]) {
      const plan = db.sqlite.prepare('EXPLAIN QUERY PLAN ' + latestCloudStatusQuery(fixed)).all('owner', 0, 'owner');
      expect(plan.some(row => row.detail.includes(fixed ? 'idx_cloud_latest_fix' : 'idx_cloud_latest_packet'))).toBe(true);
    }
    // One newly introduced index must keep actual builds off the batch path.
    db.sqlite.exec('DROP INDEX idx_cloud_track_successors');
    db.executeAsync.mockClear(); db.executeBatchAsync.mockClear();
    await createCloudDatabase({ ...db }).initialize();
    expect(db.executeAsync.mock.calls.filter(([sql]) => indexSql(sql))).toHaveLength(11);
    expect(db.executeBatchAsync.mock.calls.some(([commands]) => commands.some(command => indexSql(command.query)))).toBe(false);
    expect(db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cloud_%' ORDER BY name").all()).toEqual(schema);
  } finally { db.close(); }
});

test('missing indexes retain individual upgrade failures, rows and same-owner retry', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    db.sqlite.exec(`ALTER TABLE supabase_dog_status ADD COLUMN owner_user_id TEXT;
      ALTER TABLE supabase_dog_status ADD COLUMN event_id TEXT;
      CREATE INDEX idx_cloud_track_stream ON supabase_dog_status(received_at);`);
    const now = Date.now();
    const insert = db.sqlite.prepare(`INSERT INTO supabase_dog_status
      (received_at,owner_user_id,event_id,master_id,slave_id,slave_lat,slave_lon)
      VALUES (?,'owner','duplicate',5,6,25,121)`);
    insert.run(now - 1000); insert.run(now);
    const before = db.sqlite.prepare('SELECT id,received_at,owner_user_id,event_id,master_id,slave_id,slave_lat,slave_lon FROM supabase_dog_status ORDER BY id').all();
    const cloud = createCloudDatabase(db);
    await expect(cloud.initialize()).rejects.toThrow(/UNIQUE/);
    expect(db.sqlite.prepare('SELECT id,received_at,owner_user_id,event_id,master_id,slave_id,slave_lat,slave_lon FROM supabase_dog_status ORDER BY id').all()).toEqual(before);
    // Real builds retain the original per-statement migration boundary.
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='idx_cloud_track_stream'").get()).toBeUndefined();
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='idx_cloud_latest_fix'").get()).toBeDefined();
    expect(db.executeBatchAsync.mock.calls.some(([commands]) => commands.some(command => indexSql(command.query)))).toBe(false);
    expect(db.sqlite.prepare('SELECT track_at=received_at AS fallback FROM supabase_dog_status').all()).toEqual([{ fallback: 1 }, { fallback: 1 }]);
    db.sqlite.exec("UPDATE supabase_dog_status SET event_id='repaired' WHERE id=2");
    await expect(cloud.initialize()).resolves.toBeUndefined();
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='idx_cloud_track_stream'").get()).toBeUndefined();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cloud_%'").get().n).toBe(10);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(2);
  } finally { db.close(); }
});

test('index batch remains inside the shared connection migration lock', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    await createCloudDatabase(db).initialize();
    const execute = db.executeBatchAsync;
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const connection = { ...db, executeBatchAsync: async commands => {
      if (commands.some(command => indexSql(command.query))) { enter(); await gate; }
      return execute(commands);
    } };
    const ready = createCloudDatabase(connection).initialize();
    await entered;
    let interleaved = false;
    const read = withConnectionLock(connection, () => { interleaved = true; return 17; });
    await Promise.resolve();
    expect(interleaved).toBe(false);
    release();
    await expect(read).resolves.toBe(17);
    await ready;
  } finally { db.close(); }
});
