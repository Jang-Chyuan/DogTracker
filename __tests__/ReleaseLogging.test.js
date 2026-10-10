import fs from 'fs';
import path from 'path';
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
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
    for (const event of ['latest-published', 'archive-published']) {
      cloudSyncDiagnostic(event, { attempt: 2, elapsedMs: 123, revision: 3,
        owner: 'private', master: 7, slave: 6, cutoff: 1791547200000, url: 'https://private.invalid',
        payload: { latitude: 25 }, error: new Error('private') });
    }
    expect(spy.mock.calls).toEqual([
      ['[CloudSync] latest-published', { attempt: 2, elapsedMs: 123, revision: 3 }],
      ['[CloudSync] archive-published', { attempt: 2, elapsedMs: 123, revision: 3 }],
    ]);
    spy.mockClear();
    for (const event of ['latest-published', 'archive-published']) {
      for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 'private'])
        cloudSyncDiagnostic(event, { attempt: 1, elapsedMs: 0, revision });
      for (const elapsedMs of [-1, NaN, Infinity, 'private'])
        cloudSyncDiagnostic(event, { attempt: 1, elapsedMs, revision: 1 });
    }
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('a refused logging sink cannot change cloud download outcomes', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => { throw new Error('sink refused'); });
  try {
    const { cloudSyncDiagnostic } = require('../src/logger');
    expect(() => cloudSyncDiagnostic('latest-published', { attempt: 1, elapsedMs: 0, revision: 1 })).not.toThrow();
    expect(() => cloudSyncDiagnostic('archive-published', { attempt: 1, elapsedMs: 0, revision: 1 })).not.toThrow();
    expect(() => cloudSyncDiagnostic('failure', { attempt: 1, phase: 'download', failureKind: 'network' })).not.toThrow();
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
