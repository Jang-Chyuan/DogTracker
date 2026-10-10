import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
const NOW = Date.parse('2026-01-02T12:00:00Z');
let sync, connection, log;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); log = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(async () => { await sync?.dispose(); connection?.close(); log.mockRestore(); sync = connection = null; jest.useRealTimers(); });
async function database() { connection = createMemoryConnection(); await createDogDatabase(connection).initialize(); const db = createCloudDatabase(connection); await db.initialize(); return db; }
const start = async () => { sync.setSession({ user: { id: 'a' } }); sync.setForeground(true); await jest.advanceTimersByTimeAsync(1); };
test('real SDK overlap advances physical/archive proof but retains the material token until an actual new event', async () => {
  const db = await database();
  const events = [cloudEvent(1, NOW - 1000)];
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events }).client });
  await start();
  const first = sync.historyPublication();
  expect(first.dataRevision).toEqual(expect.any(Number));
  await jest.advanceTimersByTimeAsync(30000);
  const unchanged = sync.historyPublication();
  expect(unchanged.publishedRevision).toBeGreaterThan(first.publishedRevision);
  expect(unchanged.archiveCutoff).toBeGreaterThan(first.archiveCutoff);
  expect(unchanged.dataRevision).toBe(first.dataRevision);
  events.push(cloudEvent(2, NOW + 40000));
  await jest.advanceTimersByTimeAsync(30000);
  expect(sync.historyPublication().dataRevision).toBeGreaterThan(first.dataRevision);
});
test('legacy undefined publish result keeps material revision unknown rather than certifying no change', async () => {
  const db = await database();
  const publish = db.publishDownload;
  db.publishDownload = async (...args) => { await publish(...args); };
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] }).client });
  await start();
  expect(sync.historyPublication()).toMatchObject({ dataRevision: null, publishedPending: false, archiveRevision: 1 });
});
test('old owner committing physically cannot publish a known material token into replacement session', async () => {
  const db = await database();
  let enter, release;
  const entered = new Promise(r => { enter = r; }), held = new Promise(r => { release = r; });
  const batch = connection.executeBatchAsync;
  connection.executeBatchAsync = async commands => {
    if (commands.some(c => c.query.includes('INSERT OR REPLACE INTO cloud_archive_publication'))) { enter(); await held; }
    return batch(commands);
  };
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] }).client });
  await start(); await entered;
  sync.setSession({ user: { id: 'b' } }); sync.setForeground(false);
  expect(sync.historyPublication()).toMatchObject({ owner: 'b', dataRevision: null, publishedPending: true });
  release(); await jest.advanceTimersByTimeAsync(1);
  expect(sync.historyPublication()).toMatchObject({ owner: 'b', dataRevision: null, publishedPending: false, archiveRevision: 0 });
});
