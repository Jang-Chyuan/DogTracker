/* global globalThis, performance */
const load = () => require('../src/diagnostics/StartupPhases');
let output, clock;
beforeEach(() => {
  jest.resetModules();
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = false;
  output = jest.spyOn(console, 'info').mockImplementation(() => {});
  let at = 0;
  clock = jest.spyOn(performance, 'now').mockImplementation(() => ++at);
});
afterEach(() => {
  delete globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__;
  output.mockRestore();
  clock.mockRestore();
});
test('ordinary release returns the exact promise without a handler or logging', () => {
  const promise = Promise.resolve({ privatePayload: true });
  const then = jest.spyOn(promise, 'then');
  expect(load().startupPhase('phone-day-read', () => promise)).toBe(promise);
  expect(then).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
});
test('explicit diagnostics have fixed phases, bounded sequences and monotonic durations only', async () => {
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = true;
  clock.mockReturnValueOnce(20).mockReturnValueOnce(55)
    .mockReturnValueOnce(60).mockReturnValueOnce(90);
  const { startupPhase, markStartupPhase } = load();
  const privateValue = { coordinate: 'private', token: 'secret', id: 123 };
  expect(await startupPhase('phone-day-read', () => Promise.resolve(privateValue))).toBe(privateValue);
  const error = new Error('private raw error with token');
  await expect(startupPhase('phone-day-read', () => Promise.reject(error))).rejects.toBe(error);
  for (let i = 0; i < 1000; i += 1) markStartupPhase('phone-day-read');
  markStartupPhase('private arbitrary key');
  expect(output).toHaveBeenCalledTimes(4);
  const records = output.mock.calls.map(call => JSON.parse(call[1]));
  expect(records).toEqual([
    { phase: 'phone-day-read', sequence: 1, event: 'begin', atMs: 20, durationMs: 0 },
    { phase: 'phone-day-read', sequence: 1, event: 'end', atMs: 55, durationMs: 35 },
    { phase: 'phone-day-read', sequence: 2, event: 'begin', atMs: 60, durationMs: 0 },
    { phase: 'phone-day-read', sequence: 2, event: 'failed', atMs: 90, durationMs: 30 },
  ]);
  expect(JSON.stringify(output.mock.calls)).not.toMatch(/private|secret|token|123/);
});
test('synchronous phase rethrows the same error and completion emits once', () => {
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = true;
  const { startupPhase, beginStartupPhase } = load();
  const error = new Error('private');
  expect(() => startupPhase('phone-model', () => { throw error; })).toThrow(error);
  const finish = beginStartupPhase('map-mounted');
  finish(); finish('failed');
  expect(output).toHaveBeenCalledTimes(4);
});


test('real feed distinguishes a pending native query from a pending position-context callback', async () => {
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = true;
  const { createTrackingFeed } = require('../src/tracking/TrackingFeed');
  let latest, context;
  const onReady = jest.fn();
  const feed = createTrackingFeed({
    getLatest: () => new Promise(resolve => { latest = resolve; }),
    getPositionContext: () => new Promise(resolve => { context = resolve; }),
    getLatestByTimeCursor: async () => [], getAfterId: async () => [],
  }, { includeHistory: true, onInitialSnapshotReady: onReady });
  const task = feed.refresh();
  const records = () => output.mock.calls.map(call => JSON.parse(call[1]));
  expect(records().map(r => [r.phase, r.event])).toEqual([['initial-latest', 'begin']]);
  latest({ id: 1, receivedAt: 1000 });
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  expect(onReady).not.toHaveBeenCalled();
  expect(records().map(r => [r.phase, r.event])).toEqual([
    ['initial-latest', 'begin'], ['initial-latest', 'end'], ['initial-position-context', 'begin'],
  ]);
  context([]);
  await task;
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(records().at(-1)).toMatchObject({ phase: 'initial-position-context', event: 'end' });
});


test('release diagnostic emitter rejects arbitrary payloads and malformed fields', () => {
  const previous = globalThis.__DEV__;
  globalThis.__DEV__ = false;
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = true;
  try {
    const { logger, logStartupPhase } = require('../src/logger');
    logger.info({ token: 'secret' }, new Error('private'));
    const valid = ['phone-day-read', 1, 'end', 50, 20];
    for (const invalid of [
      [{ token: 'secret' }, 1, 'end', 50, 20],
      ['private unknown', 1, 'end', 50, 20],
      ['phone-day-read', 3, 'end', 50, 20],
      ['phone-day-read', 1, 'private error', 50, 20],
      ['phone-day-read', 1, 'end', NaN, 20],
      ['phone-day-read', 1, 'end', 50, Infinity],
      ['phone-day-read', 1, 'end', -1, 20],
      ['phone-day-read', 1, 'end', 50, -1],
      [...valid, { token: 'secret' }],
    ]) logStartupPhase(...invalid);
    expect(output).not.toHaveBeenCalled();
    logStartupPhase(...valid);
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls[0][1])).toEqual({ phase: 'phone-day-read', sequence: 1,
      event: 'end', atMs: 50, durationMs: 20 });
    globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = false;
    logStartupPhase(...valid);
    expect(output).toHaveBeenCalledTimes(1);
  } finally { globalThis.__DEV__ = previous; }
});
