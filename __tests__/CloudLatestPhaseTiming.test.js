import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';
import { withLatestSyncSlot } from '../src/cloud/CloudSyncSlot';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => jest.advanceTimersByTimeAsync(1);
let engine, info, clock;
beforeEach(() => {
  jest.useFakeTimers(); clock = 0;
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  await engine?.dispose(); engine = null;
  info.mockRestore(); jest.useRealTimers();
});

function fixture() {
  let snapshot;
  const states = [];
  const database = {
    latestStorageIsolated: true,
    initializeLatest: jest.fn(async () => {}),
    readArchivePublication: jest.fn(async () => null),
    readLatestSnapshot: jest.fn(async () => snapshot ?? null),
    publishLatestSnapshot: jest.fn(async (_owner, value) => { snapshot = { ...value, verified: true, revision: 1 }; return 1; }),
    beginDownload: jest.fn(async () => {}),
    publishDownload: jest.fn(async () => {}),
  };
  const membership = jest.fn(async () => ({ data: [] }));
  const client = { from: () => {
    const query = {};
    for (const name of ['select', 'eq', 'order', 'range']) query[name] = () => query;
    query.abortSignal = membership;
    return query;
  } };
  const downloadLatest = jest.fn(async ({ cutoff }) => ({ cutoff, dogs: [] }));
  engine = createIndependentCloudSync({ client, database, downloadLatest,
    downloadContext: async ({ snapshot: value }) => value, now: () => clock,
    onChange: state => { states.push(state); const p = engine?.mapPublication(); if (p?.readback) p.acknowledgeMapRead(p.readback); } });
  const start = async () => {
    engine.setForeground(true); engine.setSession({ user: { id: 'fictional-owner' } });
    await flush();
  };
  return { database, membership, downloadLatest, start, current: () => states.at(-1) };
}
const published = () => info.mock.calls.filter(([event]) => event === '[CloudSync] latest-published');
const keys = ['slotWaitMs', 'initializeMs', 'archiveProofMs', 'latestCacheReadMs', 'mastersMs', 'latestHTTPMs', 'snapshotCommitMs', 'sessionMs'];

// Delay the real awaited operation; the global slot itself is never mocked.
test.each([
  ['slotWaitMs', 'slot'], ['initializeMs', 'initializeLatest'],
  ['latestCacheReadMs', 'readLatestSnapshot'], ['mastersMs', 'membership'],
  ['latestHTTPMs', 'downloadLatest'], ['snapshotCommitMs', 'publishLatestSnapshot'],
])('%s distinguishes its delayed operation from every other phase', async (timing, operation) => {
  const f = fixture();
  const gate = deferred(), entered = deferred();
  let occupying;
  if (operation === 'slot') {
    occupying = withLatestSyncSlot(async () => { entered.resolve(); await gate.promise; });
    await entered.promise;
  } else {
    const fn = f.database[operation] || f[operation];
    const original = fn.getMockImplementation();
    fn.mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return original(...args); });
  }
  await f.start();
  await entered.promise;
  expect(published()).toHaveLength(0);
  if (operation === 'slot') expect(f.database.initializeLatest).not.toHaveBeenCalled();
  clock += 900;
  gate.resolve();
  if (occupying) await occupying;
  await flush();
  expect(published()).toEqual([['[CloudSync] latest-published', {
    attempt: 1, elapsedMs: 900, revision: 1,
    ...Object.fromEntries(keys.map(key => [key, key === timing ? 900 : 0])),
  }]]);
  expect(f.current()).toMatchObject({ snapshotPending: false, archivePending: false, snapshotRevision: 2, archiveRevision: 1 });
});

test.each([
  ['background', 'download'], ['scope', 'download'],
  ['background', 'commit'], ['scope', 'commit'],
])('late %s invalidation during %s cannot log an accepted old snapshot', async (invalidate, stage) => {
  const f = fixture(), gate = deferred();
  if (stage === 'download')
    f.downloadLatest.mockImplementationOnce(async ({ cutoff }) => { await gate.promise; return { cutoff, dogs: [] }; });
  else f.database.publishLatestSnapshot.mockImplementationOnce(async () => { await gate.promise; return 1; });
  await f.start();
  expect(f.downloadLatest).toHaveBeenCalledTimes(1);
  if (invalidate === 'background') engine.setForeground(false);
  else engine.setSession(null);
  clock += 2000; gate.resolve(); await flush();
  expect(f.database.publishLatestSnapshot).toHaveBeenCalledTimes(stage === 'commit' ? 1 : 0);
  expect(published()).toHaveLength(0);
  expect(f.current().snapshotRevision).toBe(0);
});

test('refused diagnostic sink cannot change accepted snapshot or archive publication', async () => {
  const f = fixture();
  info.mockImplementation(() => { throw new Error('sink refused'); });
  await f.start();
  expect(f.database.publishLatestSnapshot).toHaveBeenCalledTimes(2);
  expect(f.database.publishDownload).toHaveBeenCalledTimes(1);
  expect(f.current()).toMatchObject({ busy: false, snapshotRevision: 2, archiveRevision: 1, error: '' });
});
