import { createCloudSync } from '../src/cloud/CloudSync';
import { withCloudSyncSlot } from '../src/cloud/CloudSyncSlot';

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

function fixture({ legacy = false } = {}) {
  const states = [];
  const database = {
    initialize: jest.fn(async () => {}),
    readArchivePublication: jest.fn(async () => null),
    readLatestSnapshot: jest.fn(async () => null),
    publishLatestSnapshot: jest.fn(async () => 1),
    beginDownload: jest.fn(async () => {}),
    publishDownload: jest.fn(async () => {}),
  };
  if (legacy) delete database.publishLatestSnapshot;
  const membership = jest.fn(async () => ({ data: [] }));
  const client = { from: () => {
    const query = {};
    for (const name of ['select', 'eq', 'order', 'range']) query[name] = () => query;
    query.abortSignal = membership;
    return query;
  } };
  const downloadLatest = jest.fn(async ({ cutoff }) => ({ cutoff, dogs: [] }));
  engine = createCloudSync({ client, database, downloadLatest,
    downloadContext: async ({ snapshot }) => snapshot, now: () => clock,
    onChange: state => states.push(state) });
  const start = async () => {
    engine.setForeground(true); engine.setSession({ user: { id: 'fictional-owner' } });
    await flush();
  };
  return { database, membership, downloadLatest, start, current: () => states.at(-1) };
}
const published = () => info.mock.calls.filter(([event]) => event === '[CloudSync] latest-published');
const keys = ['slotWaitMs', 'initializeMs', 'archiveProofMs', 'latestCacheReadMs', 'mastersMs', 'latestHTTPMs', 'snapshotCommitMs'];

// Delay the real awaited operation; the global slot itself is never mocked.
test.each([
  ['slotWaitMs', 'slot'], ['initializeMs', 'initialize'], ['archiveProofMs', 'readArchivePublication'],
  ['latestCacheReadMs', 'readLatestSnapshot'], ['mastersMs', 'membership'],
  ['latestHTTPMs', 'downloadLatest'], ['snapshotCommitMs', 'publishLatestSnapshot'],
])('%s distinguishes its delayed operation from every other phase', async (timing, operation) => {
  const f = fixture();
  const gate = deferred(), entered = deferred();
  let occupying;
  if (operation === 'slot') {
    occupying = withCloudSyncSlot(async () => { entered.resolve(); await gate.promise; });
    await entered.promise;
  } else {
    const fn = f.database[operation] || f[operation];
    const original = fn.getMockImplementation();
    fn.mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return original(...args); });
  }
  await f.start();
  await entered.promise;
  expect(published()).toHaveLength(0);
  if (operation === 'slot') expect(f.database.initialize).not.toHaveBeenCalled();
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

test('legacy sync has no latest phase payload and retains recovery diagnostics', async () => {
  const f = fixture({ legacy: true });
  f.database.initialize.mockRejectedValueOnce(new Error('storage refused'));
  await f.start();
  engine.retry(); await flush();
  expect(published()).toHaveLength(0);
  expect(info.mock.calls).toEqual([
    ['[CloudSync] failure', { attempt: 1, phase: 'initialize', failureKind: 'storage', status: null }],
    ['[CloudSync] recovered', { attempt: 2, elapsedMs: 0 }],
  ]);
  expect(f.current()).toMatchObject({ busy: false, mapSuccessRevision: 1, error: '' });
});

test('refused diagnostic sink cannot change accepted snapshot or archive publication', async () => {
  const f = fixture();
  info.mockImplementation(() => { throw new Error('sink refused'); });
  await f.start();
  expect(f.database.publishLatestSnapshot).toHaveBeenCalledTimes(2);
  expect(f.database.publishDownload).toHaveBeenCalledTimes(1);
  expect(f.current()).toMatchObject({ busy: false, snapshotRevision: 2, archiveRevision: 1, error: '' });
});
