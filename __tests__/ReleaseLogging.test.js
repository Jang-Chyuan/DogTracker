import fs from 'fs';
import path from 'path';
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
test('private cloud attempt logger requires opt-in and the exact integer schema, rebuilding without caller serialization', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const { privateCloudAttemptDiagnostic } = require('../src/logger');
  const { createCloudAttemptDiagnostics } = require('../src/diagnostics/CloudAttemptDiagnostics');
  let valid;
  const observer = createCloudAttemptDiagnostics({ enabled: () => true, clock: () => 0, sink: value => { valid = value; } });
  observer.begin(1).finish(1, 'download', 'timeout', true); observer.close();
  const previous = global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__;
  try {
    delete global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__;
    privateCloudAttemptDiagnostic(valid); expect(spy).not.toHaveBeenCalled();
    global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ = true;
    const inherited = Object.assign(Object.create({ toJSON: () => 'private-url' }), valid);
    privateCloudAttemptDiagnostic(inherited);
    expect(spy.mock.calls).toEqual([['DOGTRACKER_PRIVATE_CLOUD_ATTEMPT', JSON.stringify(valid)]]);
    spy.mockClear();
    for (const key of Object.keys(valid)) {
      for (const bad of ['private-url', 1.5, Infinity, NaN, new Error('private-token')])
        privateCloudAttemptDiagnostic({ ...valid, [key]: bad });
      const missing = { ...valid }; delete missing[key]; privateCloudAttemptDiagnostic(missing);
    }
    for (const [key, bad] of [['schema', 2], ['attempt', 0], ['attempt', 2147483648], ['terminal', 4],
      ['phase', 7], ['phase', -2], ['failureKind', 5], ['foreground', 2], ['clockValid', 2],
      ['storageAggregate', 0], ['capped', 2], ['fetchStatus', 99], ['allFetchStatus', 600], ['fetchMs', -1]])
      privateCloudAttemptDiagnostic({ ...valid, [key]: bad });
    for (const extra of [{ url: 'private-url' }, { auth: 'private-token' }, { toJSON: () => 'private-token' },
      { [Symbol('private-token')]: 1 }]) privateCloudAttemptDiagnostic({ ...valid, ...extra });
    const hidden = { ...valid }; Object.defineProperty(hidden, 'private', { value: 'private-token' });
    privateCloudAttemptDiagnostic(hidden);
    expect(spy).not.toHaveBeenCalled();
    let reads = 0;
    const once = { ...valid };
    Object.defineProperty(once, 'fetchMs', { enumerable: true, get: () => ++reads === 1 ? 0 : 'private-token' });
    privateCloudAttemptDiagnostic(once);
    expect(reads).toBe(1); expect(JSON.parse(spy.mock.calls[0][1])).toEqual(valid);
    spy.mockImplementation(() => { throw new Error('sink refused'); });
    expect(() => privateCloudAttemptDiagnostic(valid)).not.toThrow();
  } finally {
    if (previous === undefined) delete global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__;
    else global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ = previous;
    spy.mockRestore();
  }
});
test('src has no console.log/info bypasses for sensitive fields outside logger', () => {
  for (const file of files(path.join(__dirname, '../src')).filter(name => /\.[jt]sx?$/.test(name) && !name.endsWith('/logger.js'))) {
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/console\s*\.\s*(log|info|warn|error)\s*\(/);
  }
});
test('release logger drops all payloads including error objects', () => {
  const previous = global.__DEV__; global.__DEV__ = false;
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  require('../src/logger').logger.info({ deviceId: 'private' }, new Error('coordinates'));
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); global.__DEV__ = previous;
});
test('release cloud diagnostic rebuilds fixed safe payloads and ignores private fields', () => {
  const previous = global.__DEV__; global.__DEV__ = false;
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    const privateFields = { owner: 'private-account', masterId: 7, url: 'https://private.invalid',
      message: 'private coordinates', error: new Error('private response'), payload: { latitude: 25, longitude: 121 } };
    cloudSyncDiagnostic('failure', { ...privateFields, attempt: 1, phase: 'publish', failureKind: 'storage', status: 503 });
    cloudSyncDiagnostic('recovered', { ...privateFields, attempt: 2, elapsedMs: 700 });
    cloudSyncDiagnostic('failure', { ...privateFields, attempt: 3, phase: 'masters', failureKind: 'network', status: 'private-status' });
    expect(spy.mock.calls).toEqual([
      ['[CloudSync] failure', { attempt: 1, phase: 'publish', failureKind: 'storage', status: 503 }],
      ['[CloudSync] recovered', { attempt: 2, elapsedMs: 700 }],
      ['[CloudSync] failure', { attempt: 3, phase: 'masters', failureKind: 'network', status: null }],
    ]);
  } finally { spy.mockRestore(); global.__DEV__ = previous; }
});
test('release cloud diagnostic refuses arbitrary event names, text fields and nonnumeric counters', () => {
  const previous = global.__DEV__; global.__DEV__ = false;
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    const failure = { attempt: 1, phase: 'download', failureKind: 'network', status: null };
    cloudSyncDiagnostic('private-message', failure);
    for (const fields of [null, { ...failure, attempt: 'private-account' }, { ...failure, attempt: 0 },
      { ...failure, attempt: Infinity }, { ...failure, phase: 'https://private.invalid' },
      { ...failure, failureKind: new Error('private-response') }]) cloudSyncDiagnostic('failure', fields);
    for (const elapsedMs of ['private-message', NaN, Infinity, -1, new Error('private-response')])
      cloudSyncDiagnostic('recovered', { attempt: 2, elapsedMs });
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); global.__DEV__ = previous; }
});
test('native main sources log only through AppLog (silent in release)', () => {
  const root = path.join(__dirname, '../android/app/src/main/java');
  for (const file of files(root).filter(name => name.endsWith('.kt') || name.endsWith('.java'))) {
    if (file.endsWith('/AppLog.kt')) continue;
    expect([file, fs.readFileSync(file, 'utf8').match(/(^|[^.\w])(android\.util\.)?Log\.[vdiwe]\(/m)?.[0] ?? null])
      .toEqual([file, null]);
  }
});

test('release publication events rebuild only bounded numeric fields', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    for (const event of ['latest-published', 'archive-published', 'latest-applied']) {
      cloudSyncDiagnostic(event, { attempt: 2, elapsedMs: 123, revision: 3,
        owner: 'private', master: 7, slave: 6, cutoff: 1791547200000, url: 'https://private.invalid',
        payload: { latitude: 25 }, error: new Error('private') });
    }
    expect(spy.mock.calls).toEqual([
      ['[CloudSync] latest-published', { attempt: 2, elapsedMs: 123, revision: 3 }],
      ['[CloudSync] archive-published', { attempt: 2, elapsedMs: 123, revision: 3 }],
      ['[CloudSync] latest-applied', { attempt: 2, elapsedMs: 123, revision: 3 }],
    ]);
    spy.mockClear();
    for (const event of ['latest-published', 'archive-published', 'latest-applied']) {
      for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 'private'])
        cloudSyncDiagnostic(event, { attempt: 1, elapsedMs: 0, revision });
      for (const elapsedMs of [-1, NaN, Infinity, 'private'])
        cloudSyncDiagnostic(event, { attempt: 1, elapsedMs, revision: 1 });
    }
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('release context events rebuild only aggregate counts and the shared failure enum', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    const privateFields = { owner: 'private-account', masterIds: [7], slaveId: 6, cutoff: 1791547200000,
      url: 'https://private.invalid', payload: { latitude: 25 }, error: new Error('private response'), status: 503 };
    const failed = { attempt: 2, elapsedMs: 10000, failureKind: 'timeout', dogs: 3, completedDogs: 1, requests: 5 };
    cloudSyncDiagnostic('context-failed', { ...privateFields, ...failed });
    cloudSyncDiagnostic('context-published', { ...privateFields, ...failed });
    for (const failureKind of ['auth', 'network', 'storage', 'unknown'])
      cloudSyncDiagnostic('context-failed', { ...failed, failureKind, completedDogs: 0, requests: 0, dogs: 0 });
    expect(spy.mock.calls).toEqual([
      ['[CloudSync] context-failed', failed],
      ['[CloudSync] context-published', { attempt: 2, elapsedMs: 10000, dogs: 3 }],
      ...['auth', 'network', 'storage', 'unknown'].map(failureKind => ['[CloudSync] context-failed',
        { ...failed, failureKind, dogs: 0, completedDogs: 0, requests: 0 }]),
    ]);
    spy.mockClear();
    const invalid = [
      ['attempt', 0], ['attempt', 1.5], ['attempt', 'private-account'],
      ['elapsedMs', -1], ['elapsedMs', NaN], ['elapsedMs', Infinity], ['elapsedMs', 'private'],
      ['dogs', -1], ['dogs', 1.5], ['dogs', Number.MAX_SAFE_INTEGER + 1], ['dogs', '3'],
    ];
    for (const [key, value] of invalid) {
      cloudSyncDiagnostic('context-failed', { ...failed, [key]: value });
      cloudSyncDiagnostic('context-published', { ...failed, [key]: value });
    }
    for (const [key, value] of [['failureKind', 'server'], ['failureKind', 'https://private.invalid'],
      ['failureKind', new Error('private')], ['failureKind', undefined],
      ['completedDogs', -1], ['completedDogs', 4], ['completedDogs', 0.5], ['completedDogs', undefined],
      ['requests', -1], ['requests', 2.5], ['requests', 'private'], ['requests', undefined]])
      cloudSyncDiagnostic('context-failed', { ...failed, [key]: value });
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('a refused logging sink cannot change cloud download outcomes', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => { throw new Error('sink refused'); });
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    expect(() => cloudSyncDiagnostic('latest-published', { attempt: 1, elapsedMs: 0, revision: 1 })).not.toThrow();
    expect(() => cloudSyncDiagnostic('archive-published', { attempt: 1, elapsedMs: 0, revision: 1 })).not.toThrow();
    expect(() => cloudSyncDiagnostic('latest-applied', { attempt: 1, elapsedMs: 0, revision: 1 })).not.toThrow();
    expect(() => cloudSyncDiagnostic('failure', { attempt: 1, phase: 'download', failureKind: 'network' })).not.toThrow();
    expect(() => cloudSyncDiagnostic('context-failed', { attempt: 1, elapsedMs: 0, failureKind: 'timeout',
      dogs: 1, completedDogs: 0, requests: 1 })).not.toThrow();
    expect(() => cloudSyncDiagnostic('context-published', { attempt: 1, elapsedMs: 0, dogs: 1 })).not.toThrow();
  } finally { spy.mockRestore(); }
});


test('latest timing extension is all-or-none fixed elapsed numbers; private fields never pass through', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    const base = { attempt: 2, elapsedMs: 140, revision: 3 };
    const timings = { slotWaitMs: 10, initializeMs: 20, archiveProofMs: 0,
      latestCacheReadMs: 30, mastersMs: 40, latestHTTPMs: 20, snapshotCommitMs: 10 };
    const privateFields = { owner: 'private-account', masterIds: [4, 7], slaveId: 6,
      payload: { latitude: 25 }, url: 'https://private.invalid', unknownTimingMs: 12 };
    cloudSyncDiagnostic('latest-published', { ...base, ...timings, ...privateFields });
    cloudSyncDiagnostic('archive-published', { ...base, ...timings, ...privateFields });
    expect(spy.mock.calls).toEqual([
      ['[CloudSync] latest-published', { ...base, ...timings }],
      ['[CloudSync] archive-published', base],
    ]);
    spy.mockClear();
    for (const name of Object.keys(timings)) {
      for (const invalid of [undefined, -1, NaN, Infinity, 'private-account', new Error('private-payload')])
        cloudSyncDiagnostic('latest-published', { ...base, ...timings, ...privateFields, [name]: invalid });
    }
    expect(spy.mock.calls).toHaveLength(42);
    for (const entry of spy.mock.calls) expect(entry).toEqual(['[CloudSync] latest-published', base]);
  } finally { spy.mockRestore(); }
});
test('the optional session wait passes only as a fixed number beside the complete latest timings', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    const base = { attempt: 2, elapsedMs: 140, revision: 3 };
    const timings = { slotWaitMs: 10, initializeMs: 20, archiveProofMs: 0,
      latestCacheReadMs: 30, mastersMs: 40, latestHTTPMs: 20, snapshotCommitMs: 10 };
    cloudSyncDiagnostic('latest-published', { ...base, ...timings, sessionMs: 5 });
    for (const invalid of [undefined, -1, NaN, Infinity, 'private-account'])
      cloudSyncDiagnostic('latest-published', { ...base, ...timings, sessionMs: invalid });
    // Without the complete timings it is not logged alone.
    cloudSyncDiagnostic('latest-published', { ...base, sessionMs: 5 });
    expect(spy.mock.calls).toEqual([
      ['[CloudSync] latest-published', { ...base, ...timings, sessionMs: 5 }],
      ...Array.from({ length: 5 }, () => ['[CloudSync] latest-published', { ...base, ...timings }]),
      ['[CloudSync] latest-published', base],
    ]);
  } finally { spy.mockRestore(); }
});
test('history read/model diagnostics stay silent unless the private flag is enabled', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const { historyReadDiagnostic, historyModelDiagnostic, HISTORY_READ_FLAGS } = require('../src/logger');
  const read = { sequence: 1, phase: 'row', event: 'begin', elapsedMs: 1,
    ...Object.fromEntries(HISTORY_READ_FLAGS.map(key => [key, false])) };
  const model = { sequence: 1, stage: 'replay', elapsedMs: 1, inputCount: 2 };
  try {
    delete global.__DOGTRACKER_PRIVATE_HISTORY_DIAGNOSTICS__;
    historyReadDiagnostic(read); historyModelDiagnostic(model);
    expect(spy).not.toHaveBeenCalled();
    global.__DOGTRACKER_PRIVATE_HISTORY_DIAGNOSTICS__ = true;
    historyReadDiagnostic(read); historyModelDiagnostic(model);
    expect(spy.mock.calls.map(([tag]) => tag)).toEqual(['[HistoryRead]', '[HistoryModel]']);
  } finally { delete global.__DOGTRACKER_PRIVATE_HISTORY_DIAGNOSTICS__; spy.mockRestore(); }
});

// TEMPORARY (#151, remove with logCarouselRelease): numbers only, its fixed fields.
test('the row of dogs logs only its fixed numeric fields', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const { logCarouselRelease } = require('../src/logger');
  const fields = { vx: 2.5, dt: 120, drag: -150, startCell: 1, releaseCell: 3.3, glide: 98, target: 5, count: 6 };
  logCarouselRelease({ ...fields, name: 'private', latitude: 24.99 });
  expect(spy.mock.calls).toEqual([['DogCarousel', JSON.stringify(fields)]]);
  spy.mockClear();
  logCarouselRelease({ ...fields, vx: 'fast' });
  logCarouselRelease(null);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
