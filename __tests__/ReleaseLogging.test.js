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
