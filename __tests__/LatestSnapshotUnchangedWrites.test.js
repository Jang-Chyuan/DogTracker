import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const packet = (id = 'current', slave = 6, master = 7, time = 1000) => ({ event_id: id, slave_id: slave,
  master_id: master, received_at: time, track_at: time, slave_lat: 25, slave_lon: 121,
  usb_present: null, activity_valid: 0, battery_valid: 0 });
const dog = (slave = 6) => ({ slaveId: slave, packet: packet(`current-${slave}`, slave), fix: packet(`current-${slave}`, slave),
  context: [packet(`context-${slave}`, slave, 7, 900)], seeds: [packet(`seed-${slave}`, slave, 7, 500)] });
const snapshot = (dogs, cutoff = 2000, masterIds = [7]) => ({ dogs, cutoff, masterIds });
let archive, latest, database;
beforeEach(async () => {
  archive = createMemoryConnection(); latest = createMemoryConnection(); await createDogDatabase(archive).initialize();
  database = createCloudDatabase(archive, { latestConnection: latest }); await database.initializeLatest();
  latest.sqlite.exec(`CREATE TABLE latest_row_writes(kind TEXT);
    CREATE TRIGGER track_latest_insert AFTER INSERT ON cloud_latest_snapshot BEGIN INSERT INTO latest_row_writes VALUES('insert'); END;
    CREATE TRIGGER track_latest_delete AFTER DELETE ON cloud_latest_snapshot BEGIN INSERT INTO latest_row_writes VALUES('delete'); END;
    CREATE TRIGGER track_latest_update AFTER UPDATE ON cloud_latest_snapshot BEGIN INSERT INTO latest_row_writes VALUES('update'); END`);
});
afterEach(() => { archive.close(); latest.close(); });
const writes = () => latest.sqlite.prepare('SELECT kind FROM latest_row_writes').all();
const resetWrites = () => latest.sqlite.exec('DELETE FROM latest_row_writes');

test('unchanged full latest/context avoids real dog row writes but still advances cutoff, durable revision and complete proof', async () => {
  await database.initialize();
  await database.savePage('a', [packet('archive-existing')], { masterId: 7, throughAt: '2026-10-10T00:00:00Z' });
  const progress = await database.loadSyncState('a', 7);
  const known = dog(); known.context = Array.from({ length: 500 }, (_, index) => packet(`context-${index}`, 6, 7, index + 1));
  await database.publishLatestSnapshot('a', snapshot([known])); resetWrites();
  // Normal 30s latest poll retains prior complete context.
  const { context: _context, seeds: _seeds, ...short } = known;
  expect(await database.publishLatestSnapshot('a', snapshot([short], 32000))).toBe(2);
  expect(writes()).toEqual([]);
  // Even a freshly downloaded identical context must retain the exact order.
  expect(await database.publishLatestSnapshot('a', snapshot([known], 32000))).toBe(3);
  expect(writes()).toEqual([]);
  const reopened = createCloudDatabase(archive, { latestConnection: latest });
  expect(await reopened.readLatestSnapshot('a')).toMatchObject({ revision: 3, cutoff: 32000, verified: true,
    context: known.context, seeds: known.seeds });
  expect(await database.loadSyncState('a', 7)).toEqual(progress);
});

test('unchanged packet/fix does not suppress late context, order changes or changed packet contents', async () => {
  const known = dog(); await database.publishLatestSnapshot('a', snapshot([known])); resetWrites();
  const late = { ...known, context: [...known.context, packet('late-uploaded-old', 6, 7, 800)] };
  await database.publishLatestSnapshot('a', snapshot([late], 3000));
  expect(writes().some(row => row.kind === 'insert')).toBe(true);
  expect((await database.readLatestSnapshot('a')).context).toEqual(late.context);
  resetWrites();
  const ordered = { ...late, context: [...late.context].reverse() };
  await database.publishLatestSnapshot('a', snapshot([ordered], 3000));
  expect(writes().some(row => row.kind === 'insert')).toBe(true);
  expect((await database.readLatestSnapshot('a')).context).toEqual([...late.context].reverse());
  resetWrites();
  const changedPacket = { ...ordered, packet: { ...ordered.packet, battery_percentage: 15 } };
  await database.publishLatestSnapshot('a', snapshot([changedPacket], 4000));
  expect(writes().some(row => row.kind === 'insert')).toBe(true);
  expect((await database.readLatestSnapshot('a')).packets[0].battery_percentage).toBe(15);
  resetWrites();
  const changedFix = { ...changedPacket, fix: packet('replacement-fix') };
  await database.publishLatestSnapshot('a', snapshot([changedFix], 4000));
  expect(writes().some(row => row.kind === 'insert')).toBe(true);
  expect((await database.readLatestSnapshot('a')).rows[0].event_id).toBe('replacement-fix');
  resetWrites();
  await database.publishLatestSnapshot('a', snapshot([{ ...changedFix, fix: null, context: [], seeds: [] }], 4000));
  expect(writes().some(row => row.kind === 'insert')).toBe(true);
  expect(await database.readLatestSnapshot('a')).toMatchObject({ context: [], seeds: [], rows: [] });
});

test('removed dogs and complete-empty snapshots clear only that owner; changed authority filters retained context', async () => {
  const known = dog(); known.context.push(packet('other-master-context', 6, 9, 950));
  await database.publishLatestSnapshot('a', snapshot([known, dog(8)], 2000, [7, 9]));
  await database.publishLatestSnapshot('b', snapshot([dog(10)]));
  const other = await database.readLatestSnapshot('b'); resetWrites();
  const { context: _context, seeds: _seeds, ...short } = known;
  await database.publishLatestSnapshot('a', snapshot([short], 3000, [7]));
  const current = await database.readLatestSnapshot('a');
  expect(current.packets.map(row => row.slave_id)).toEqual([6]);
  expect(current.context.map(row => row.master_id)).toEqual([7]);
  expect(writes().some(row => row.kind === 'delete')).toBe(true);
  expect(writes().some(row => row.kind === 'insert')).toBe(true);
  expect(await database.readLatestSnapshot('b')).toEqual(other);
  await database.publishLatestSnapshot('a', snapshot([], 4000));
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 3,
    cutoff: 4000, rows: [], packets: [] });
  expect(await database.readLatestSnapshot('b')).toEqual(other);
});

test('metadata failure rolls back both row changes and removals; retry commits the complete snapshot', async () => {
  await database.publishLatestSnapshot('a', snapshot([dog(), dog(8)]));
  const before = await database.readLatestSnapshot('a'); resetWrites();
  latest.sqlite.exec("CREATE TRIGGER fail_metadata BEFORE INSERT ON cloud_snapshot_state BEGIN SELECT RAISE(ABORT,'invented metadata failure'); END");
  const changed = snapshot([{ ...dog(), context: [packet('late-context')] }], 3000);
  await expect(database.publishLatestSnapshot('a', changed)).rejects.toThrow('invented metadata failure');
  expect(writes()).toEqual([]); expect(await database.readLatestSnapshot('a')).toEqual(before);
  latest.sqlite.exec('DROP TRIGGER fail_metadata');
  expect(await database.publishLatestSnapshot('a', changed)).toBe(2);
  expect((await database.readLatestSnapshot('a')).packets.map(row => row.slave_id)).toEqual([6]);
});

test('an identical snapshot still rejects a stale generation or durable deletion fence', async () => {
  const known = snapshot([dog()]); await database.publishLatestSnapshot('a', known); resetWrites();
  const before = await database.readLatestSnapshot('a');
  const execute = latest.executeAsync.getMockImplementation(); let current = true;
  latest.executeAsync.mockImplementation(async (query, params) => {
    const result = await execute(query, params);
    if (query.startsWith('SELECT slave_id,packet_json')) current = false;
    return result;
  });
  await expect(database.publishLatestSnapshot('a', known, () => current)).rejects.toThrow();
  latest.executeAsync.mockImplementation(execute);
  expect(writes()).toEqual([]); expect(await database.readLatestSnapshot('a')).toEqual(before);
  await expect(database.clearLatestAndRun(async () => { throw new Error('invented deletion failure'); })).rejects.toThrow();
  await expect(database.publishLatestSnapshot('a', known)).rejects.toThrow();
  await database.clearLatestAndRun(async () => {});
  expect(await database.publishLatestSnapshot('a', known)).toBe(1);
});
