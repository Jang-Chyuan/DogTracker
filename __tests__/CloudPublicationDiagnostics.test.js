import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
let sync, connection, log;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); log = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(async () => { await sync?.dispose(); connection?.close(); log.mockRestore(); sync = connection = null; jest.useRealTimers(); });
async function database() {
  connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  const db = createCloudDatabase(connection); await db.initialize(); return db;
}
const start = async () => { sync.setSession({ user: { id: 'a' } }); sync.setForeground(true); await jest.advanceTimersByTimeAsync(1); };
const stages = () => log.mock.calls.filter(([name]) => ['[CloudSync] latest-published', '[CloudSync] archive-published'].includes(name));

test.each(['complete', 'failure', 'cancel'])('real SDK latest stage precedes held archive; %s records only accepted publication', async mode => {
  const db = await database();
  const entered = deferred(), release = deferred();
  let held = false;
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000), cloudEvent(2, NOW - 500, { latitude: 0, longitude: 0 })],
    beforeRead: async call => {
      if (call.phase !== 'archive' || held) return;
      held = true; entered.resolve(); await release.promise;
      if (mode === 'failure') throw new Error('archive unavailable');
    },
  });
  sync = createCloudSync({ database: db, client: network.client });
  try {
    await start(); await entered.promise;
    expect(stages()).toEqual([['[CloudSync] latest-published', { attempt: 1, elapsedMs: expect.any(Number), revision: 1 }]]);
    const accepted = await db.readLatestSnapshot('a');
    expect(accepted.packets[0].event_id).toBe(cloudEvent(2, NOW - 500).event_id);
    expect(accepted.rows[0].event_id).toBe(cloudEvent(1, NOW - 1000).event_id);
    expect(await db.readArchivePublication('a')).toBeNull();
    if (mode === 'cancel') sync.setForeground(false);
    release.resolve(); await jest.advanceTimersByTimeAsync(1);
    expect(await db.readLatestSnapshot('a')).toEqual(accepted);
    if (mode === 'complete') {
      expect(stages()).toEqual([
        ['[CloudSync] latest-published', { attempt: 1, elapsedMs: expect.any(Number), revision: 1 }],
        ['[CloudSync] archive-published', { attempt: 1, elapsedMs: expect.any(Number), revision: 1 }],
      ]);
      expect(stages()[1][1].elapsedMs).toBeGreaterThanOrEqual(stages()[0][1].elapsedMs);
      expect(await db.readArchivePublication('a')).toMatchObject({ revision: 1 });
    } else {
      expect(stages()).toHaveLength(1);
      expect(await db.readArchivePublication('a')).toBeNull();
    }
  } finally { release.resolve(); }
});

test.each(['latest', 'archive'])('owner replacement during native %s commit cannot log its stale success', async phase => {
  const db = await database();
  const entered = deferred(), release = deferred(), batch = connection.executeBatchAsync;
  connection.executeBatchAsync = async commands => {
    const held = commands.some(command => phase === 'latest'
      ? command.query.includes('INSERT OR REPLACE INTO cloud_snapshot_state') && command.params[3] === 'remote'
      : command.query.includes('INSERT OR REPLACE INTO cloud_archive_publication'));
    if (held) { entered.resolve(); await release.promise; }
    return batch(commands);
  };
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] }).client });
  try {
    await start(); await entered.promise;
    expect(stages()).toHaveLength(phase === 'latest' ? 0 : 1);
    sync.setSession({ user: { id: 'b' } }); sync.setForeground(false);
    release.resolve(); await jest.advanceTimersByTimeAsync(1);
    expect(stages()).toHaveLength(phase === 'latest' ? 0 : 1);
    expect(await db.readArchivePublication('b')).toBeNull();
    // Native commit may finish physically for a; acceptance for the new
    // generation is still rejected and must not emit a successful stage.
    expect(sync.mapPublication()).toMatchObject({ owner: 'b', mapSuccessRevision: 0 });
  } finally { release.resolve(); }
});

test('a throwing release sink leaves real latest and archive completion successful', async () => {
  const db = await database();
  log.mockImplementation(() => { throw new Error('sink refused'); });
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] }).client });
  await start();
  expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 2 });
  expect(sync.historyPublication()).toMatchObject({ archiveRevision: 1, archiveError: '' });
  expect(await db.readArchivePublication('a')).toMatchObject({ revision: 1 });
});
