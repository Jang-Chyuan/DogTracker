import { performance } from 'perf_hooks';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const owner = 'anonymous-capacity';
const row = (event_id, time, slave_id = 6, fix = true) => ({ event_id,
  master_id: 7, slave_id, received_at: time, track_at: time, track_time_version: 1,
  slave_lat: fix ? 24.9892 : 0, slave_lon: fix ? 121.3132 : 0,
  activity_valid: 0, battery_valid: 0 });
const read = async (connection, table) => (await connection.executeAsync(`SELECT event_id FROM ${table} ORDER BY event_id`)).results.map(value => value.event_id);
async function setup(cap) {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection, { maxRows: cap });
  await database.initialize();
  return { connection, database };
}

test('full cache admits new pages without publishing partial and protects rare dog packet and valid fix', async () => {
  const { connection, database } = await setup(16);
  try {
    await database.savePage(owner, [row('rare-fix', 1, 9), row('rare-no-gps', 2, 9, false),
      ...Array.from({ length: 14 }, (_, i) => row(`old-${i}`, i + 3))]);
    const before = await read(connection, 'supabase_dog_status');
    await database.beginDownload(owner);
    for (let i = 0; i < 10; i++) await database.savePage(owner, [row(`new-${i}`, 100 + i)],
      { masterId: 7, throughAt: new Date(100 + i).toISOString(), eventId: `new-${i}` });
    expect(await read(connection, 'supabase_dog_status')).toEqual(before);
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toHaveLength(2);
    const restart = createCloudDatabase(connection, { maxRows: 16 });
    expect(await read(connection, 'supabase_dog_status')).toEqual(before);
    expect((await restart.loadSyncState(owner, 7)).event_id).toBe('new-9');
    await restart.publishDownload(owner);
    const after = await read(connection, 'supabase_dog_status');
    expect(after).toHaveLength(16);
    expect(after).toEqual(expect.arrayContaining(['rare-fix', 'rare-no-gps', 'new-9']));
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toHaveLength(0);
  } finally { connection.close(); }
});

test('empty first download uses unused cache capacity plus bounded reserve, then returns to original cap', async () => {
  const { connection, database } = await setup(16);
  try {
    await database.beginDownload(owner);
    await database.savePage(owner, Array.from({ length: 40 }, (_, i) => row(`new-${i}`, i + 1)),
      { masterId: 7, throughAt: new Date(40).toISOString(), eventId: 'new-39' });
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toHaveLength(18);
    expect(await read(connection, 'supabase_dog_status')).toHaveLength(0);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('new-39');
    await database.publishDownload(owner);
    expect(await read(connection, 'supabase_dog_status')).toHaveLength(16);
    expect(await read(connection, 'supabase_dog_status')).toContain('new-39');
  } finally { connection.close(); }
});

test('late chunk storage failure rolls back every earlier publish chunk and checkpoint', async () => {
  const { connection, database } = await setup(1200);
  try {
    await database.savePage(owner, [row('completed', 1)]);
    await database.beginDownload(owner);
    await database.savePage(owner, Array.from({ length: 1100 }, (_, i) => row(`new-${i}`, i + 2)),
      { masterId: 7, throughAt: new Date(1101).toISOString(), eventId: 'new-1099' });
    await connection.executeAsync(`CREATE TRIGGER fail_late BEFORE INSERT ON supabase_dog_status
      WHEN NEW.event_id='new-1099' BEGIN SELECT RAISE(ABORT,'storage failure'); END`);
    await expect(database.publishDownload(owner)).rejects.toThrow('storage failure');
    expect(await read(connection, 'supabase_dog_status')).toEqual(['completed']);
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toHaveLength(1100);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('new-1099');
    await connection.executeAsync('DROP TRIGGER fail_late');
    await database.publishDownload(owner);
    expect(await read(connection, 'supabase_dog_status')).toHaveLength(1101);
  } finally { connection.close(); }
});

test('capacity pressure preserves copy-on-write repair and rolls back an irreducible protected set', async () => {
  const { connection, database } = await setup(16);
  try {
    await database.savePage(owner, Array.from({ length: 16 }, (_, i) => row(`old-${i}`, i + 1)));
    await database.beginDownload(owner);
    await database.repairTrackTimes(owner, [{ event_id: 'old-15', received_at: new Date(50).toISOString(), upload_source: 'wifi' }], ['old-15']);
    await database.savePage(owner, Array.from({ length: 10 }, (_, i) => row(`new-${i}`, 100 + i)));
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toEqual(['new-9', 'old-15']);
    await expect(database.savePage(owner, [row('protected-other-dog', 200, 8)])).rejects.toThrow('手機空間不足');
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toEqual(['new-9', 'old-15']);
    await database.publishDownload(owner);
    expect((await connection.executeAsync("SELECT upload_source FROM supabase_dog_status WHERE event_id='old-15'")).results[0].upload_source).toBe('wifi');
    expect(await read(connection, 'supabase_dog_status')).toHaveLength(16);
  } finally { connection.close(); }
});

test('bounded host cost: full 20000-row cache accepts 5000 more records using 2500-row reserve', async () => {
  const { connection, database } = await setup(20000);
  try {
    for (let i = 0; i < 20000; i += 1000)
      await database.savePage(owner, Array.from({ length: 1000 }, (_, j) => row(`old-${i + j}`, i + j + 1)));
    const bytes = async () => (await connection.executeAsync('PRAGMA page_count')).results[0].page_count *
      (await connection.executeAsync('PRAGMA page_size')).results[0].page_size;
    const beforeBytes = await bytes();
    await database.beginDownload(owner);
    const started = performance.now();
    for (let i = 0; i < 5000; i += 1000)
      await database.savePage(owner, Array.from({ length: 1000 }, (_, j) => row(`new-${i + j}`, 30000 + i + j)));
    const stageMs = performance.now() - started;
    const stagedBytes = await bytes();
    expect(await read(connection, 'supabase_dog_status')).toHaveLength(20000);
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toHaveLength(2500);
    const publishing = performance.now(); await database.publishDownload(owner);
    const publishMs = performance.now() - publishing;
    expect(await read(connection, 'supabase_dog_status')).toHaveLength(20000);
    console.log(JSON.stringify({ capacityRows: 20000, downloadedRows: 5000, retainedDeltaRows: 2500,
      stageMs, publishMs, beforeBytes, stagedBytes, afterBytes: await bytes() }));
  } finally { connection.close(); }
});

test('publication cannot evict the sole latest position of another dog to satisfy the final cap', async () => {
  const { connection, database } = await setup(3);
  try {
    await database.savePage(owner, [row('dog-6', 1, 6), row('dog-7', 2, 7), row('dog-8', 3, 8)]);
    await database.beginDownload(owner);
    await database.savePage(owner, [row('dog-9', 4, 9)],
      { masterId: 7, throughAt: new Date(4).toISOString(), eventId: 'dog-9' });
    await expect(database.publishDownload(owner)).rejects.toThrow();
    expect(await read(connection, 'supabase_dog_status')).toEqual(['dog-6', 'dog-7', 'dog-8']);
    expect(await read(connection, 'cloud_auto_supabase_dog_status')).toEqual(['dog-9']);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('dog-9');
  } finally { connection.close(); }
});
