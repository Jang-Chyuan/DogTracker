import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createHistoryReadDiagnostics } from '../src/diagnostics/HistoryReadDiagnostics';
import { HISTORY_READ_FLAGS, historyReadDiagnostic } from '../src/logger';
import { useHistoryDayRows } from '../src/mapHistory/useHistoryScreen';
import { useHistoryCloud } from '../src/mapHistory/useHistoryCloud';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createDogDatabase } from '../src/database/DogDatabase';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds } from '../src/history/screen/HistoryScreenDates';
const late = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// These suites exercise the private observer; it is off unless enabled.
beforeEach(() => { global.__DOGTRACKER_PRIVATE_HISTORY_DIAGNOSTICS__ = true; });
afterEach(() => { delete global.__DOGTRACKER_PRIVATE_HISTORY_DIAGNOSTICS__; });
const payloads = spy => spy.mock.calls.filter(args => args[0] === '[HistoryRead]').map(args => args[1]);

test('release history diagnostics reconstruct only fixed enums, elapsed numbers and booleans', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const safe = { sequence: 1, phase: 'row', event: 'begin', elapsedMs: 12,
    ...Object.fromEntries(HISTORY_READ_FLAGS.map(key => [key, false])) };
  try {
    historyReadDiagnostic({ ...safe, owner: 'private', dog: 6, day: 'private date', timestamp: 123,
      payload: { latitude: 25 }, error: new Error('private'), url: 'https://private.invalid' });
    expect(payloads(spy)).toEqual([safe]); spy.mockClear();
    for (const change of [{ sequence: 0 }, { sequence: 'private' }, { sequence: Infinity },
      { phase: 'private query' }, { event: 'private error' }, { elapsedMs: -1 }, { elapsedMs: NaN },
      { elapsedMs: Infinity }, ...HISTORY_READ_FLAGS.map(key => ({ [key]: 'private' }))])
      historyReadDiagnostic({ ...safe, ...change });
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('selection counters are process monotonic and logging is bounded without timer or per-frame output', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  let clock = 100;
  try {
    const first = createHistoryReadDiagnostics(() => clock);
    clock += 5; first.emit('row', 'begin', 100); first.emit('row', 'end', 100);
    for (let i = 0; i < 100; i++) first.emit('row', 'begin', 100);
    for (let i = 0; i < 100; i++) first.emit('state', 'state', undefined, { rowsLoaded: true });
    expect(payloads(spy)).toHaveLength(4);
    expect(payloads(spy).map(p => p.elapsedMs)).toEqual([5, 5, 5, 5]);
    const second = createHistoryReadDiagnostics(() => clock);
    second.emit('row', 'begin');
    expect(payloads(spy)[4].sequence).toBeGreaterThan(payloads(spy)[0].sequence);
    expect(payloads(spy)[4].elapsedMs).toBe(0);
  } finally { spy.mockRestore(); }
});

test('an invalid deferred day read is reported rejected rather than accepted; a refused sink cannot break retry', async () => {
  jest.useFakeTimers(); let renderer, state;
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const wait = late(), diagnostic = createHistoryReadDiagnostics();
  const day = new Date(2026, 0, 1).getTime();
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedRevision: 0, publishedPending: false, dataRevision: 1 };
  const getter = () => ledger;
  const read = jest.fn().mockImplementationOnce(() => wait.promise).mockResolvedValue({ rows: [{ id: 2, time: day + 1000 }], after: {} });
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'a', clock: () => day + 86400000,
    getPublication: getter, publicationRevision: ledger.publishedRevision, publishedReads: true, requireFresh: true, diagnostic }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(payloads(spy).map(p => p.event)).toEqual(['begin']);
    ledger.publishedRevision = 2;
    await act(async () => renderer.update(<Probe />));
    await act(async () => wait.resolve({ rows: [{ id: 99, time: day + 500 }], after: { cloud: 99 } }));
    expect(state.loaded).toBe(false); expect(state.rows).toEqual([]);
    expect(payloads(spy).map(p => p.event)).toEqual(['begin', 'rejected']);
    expect(payloads(spy)[1]).toMatchObject({ fenceOpen: false, ownerMatches: true, generationMatches: true });
    spy.mockImplementation(() => { throw new Error('sink unavailable'); });
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(state.loaded).toBe(true); expect(state.rows.map(row => row.id)).toEqual([2]);
    expect(read.mock.calls[1][0].after).toEqual({});
  } finally { if (renderer) await act(async () => renderer.unmount()); spy.mockRestore(); jest.useRealTimers(); }
});

test('true SQLite proof diagnostics distinguish an awaited query and rejected generation from a completed fresh proof', async () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const connection = createMemoryConnection(), database = createCloudDatabase(connection);
  const date = '2026-01-01', bounds = dayBounds(date), cutoff = bounds.dayEnd;
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedRevision: 0, publishedPending: false, dataRevision: 1 };
  const first = late(), second = late(); let calls = 0, renderer, state;
  const diagnostic = createHistoryReadDiagnostics(), local = [];
  try {
    await createDogDatabase(connection).initialize();
    await database.initialize();
    await database.setHistoryDownloadState('a', 6, date, true, historyCoverage(bounds.dayStart, bounds.dayEnd, cutoff));
    const original = database.historyDownloadStates;
    database.historyDownloadStates = async (...args) => { await (++calls === 1 ? first.promise : second.promise); return original(...args); };
    const cloud = createHistoryCloud({ client: { from: () => { throw new Error('no remote request'); } }, database, owner: 'a', getPublication: () => ledger });
    function Probe() { state = useHistoryCloud({ cloud, slaveId: 6, scope: 'diagnostic-proof', todayKey: date, local, cutoff,
      publicationRevision: ledger.publishedRevision, diagnostic }); return null; }
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(state.completeDay(date)).toBe(false);
    expect(payloads(spy).map(p => p.event)).toEqual(['begin']);
    ledger.generation++; ledger.publishedRevision = 2;
    await act(async () => renderer.update(<Probe />));
    await act(async () => first.resolve());
    expect(state.completeDay(date)).toBe(false);
    expect(payloads(spy).filter(p => p.event === 'end')).toEqual([]);
    expect(payloads(spy).find(p => p.event === 'rejected')).toMatchObject({ generationMatches: false });
    await act(async () => second.resolve());
    expect(state.completeDay(date)).toBe(true);
    expect(payloads(spy).filter(p => p.event === 'end')).toHaveLength(1);
    expect(payloads(spy).find(p => p.event === 'end')).toMatchObject({ phase: 'proof', fenceOpen: true, completenessLoaded: true });
  } finally { first.resolve(); second.resolve(); if (renderer) await act(async () => renderer.unmount()); connection.close(); spy.mockRestore(); }
});
