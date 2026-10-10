/* global globalThis, performance */
const load = () => require('../src/diagnostics/StartupPhases');
let output;
beforeEach(() => {
  jest.resetModules();
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = false;
  output = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  delete globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__;
  output.mockRestore();
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
  const clock = jest.spyOn(performance, 'now').mockReturnValueOnce(20).mockReturnValueOnce(55)
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
  clock.mockRestore();
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
