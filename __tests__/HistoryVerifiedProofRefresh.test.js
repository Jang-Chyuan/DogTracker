import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(suffix) {
  const connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection); await database.initialize();
  const fixture = buildFixture('history-dog');
  const day = dayKey(new Date(fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(fixture.history.preferences).slaveId;
  await database.setHistoryDownloadState('a', dog, day, true, historyCoverage(bounds.dayStart, bounds.dayEnd, fixture.now));
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 0 };
  const readProof = database.historyDownloadStates;
  let hold = null;
  database.historyDownloadStates = jest.fn(async (...args) => { if (hold) await hold.promise; return readProof(...args); });
  const cloud = createHistoryCloud({ client: { from: () => { throw new Error('unexpected network'); } }, database,
    owner: 'a', getPublication: () => ledger });
  const read = jest.fn(fixture.history.readDay);
  let screen;
  const clock = () => fixture.now;
  function Probe() { screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), owner: 'a', cloud,
    read, readDays: fixture.history.readDays, clock, online: false, publicationRevision: ledger.publishedRevision, memoryScope: `verified-${suffix}` }); return null; }
  let renderer; await act(async () => { renderer = Renderer.create(<Probe />); });
  const update = async () => act(async () => renderer.update(<Probe />));
  return { ledger, database, read, day, dog, fixture, get screen() { return screen; },
    hold: value => { hold = value; }, update,
    close: async () => { await act(async () => renderer.unmount()); connection.close(); } };
}
test('true adapter retains already verified model across unchanged physical proof refresh without replay', async () => {
  const state = await setup('unchanged'); const wait = deferred();
  try {
    const accepted = state.screen.dayModel, map = state.screen.map, reads = state.read.mock.calls.length;
    expect(accepted).not.toBeNull();
    state.ledger.publishedPending = true; state.ledger.publishedRevision = 1;
    state.hold(wait); await state.update();
    expect(state.screen.dayModel).toBe(accepted); expect(state.screen.map).toBe(map);
    state.ledger.publishedPending = false; state.ledger.publishedRevision = 2;
    await state.update();
    expect(state.screen.dayModel).toBe(accepted);
    await act(async () => wait.resolve());
    expect(state.screen.dayModel).toBe(accepted); expect(state.read).toHaveBeenCalledTimes(reads);
    expect(state.database.historyDownloadStates.mock.calls.length).toBeGreaterThan(1);
  } finally { wait.resolve(); await state.close(); }
});
test('fresh complete selected-day input can reuse its accepted model after an unrelated material publication', async () => {
  const state = await setup('same-selected-input'); const wait = deferred();
  try {
    const accepted = state.screen.dayModel, reads = state.read.mock.calls.length;
    expect(accepted).not.toBeNull(); state.hold(wait);
    state.ledger.dataRevision++; state.ledger.publishedRevision += 2;
    await state.update();
    // Rule change (PR #114): today's verified model stays while the new
    // material's proof is re-read; nothing is built before that read finishes.
    expect(state.screen.dayModel).toBe(accepted);
    await act(async () => wait.resolve());
    expect(state.database.historyDownloadStates.mock.calls.length).toBeGreaterThan(1);
    expect(state.read.mock.calls.length).toBeGreaterThan(reads);
    expect(state.screen.dayModel).toBe(accepted);
  } finally { wait.resolve(); await state.close(); }
});
test('today keeps its verified model while the day rows re-read for new material', async () => {
  const state = await setup('rows-reread'); const rows = deferred();
  try {
    const accepted = state.screen.dayModel;
    expect(accepted).not.toBeNull();
    const original = state.fixture.history.readDay;
    state.read.mockImplementation(async args => { await rows.promise; return original(args); });
    state.ledger.dataRevision++; state.ledger.publishedRevision += 2; await state.update();
    // The proof re-read finished; the rows have not. Still the verified view.
    expect(state.database.historyDownloadStates.mock.calls.length).toBeGreaterThan(1);
    expect(state.screen.dayModel).toBe(accepted); expect(state.screen.loading).toBe(false);
    await act(async () => rows.resolve());
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.loading).toBe(false);
  } finally { rows.resolve(); await state.close(); }
});
test.each(['own-undefined', 'deletion', 'seed-quality'])('fresh %s selected input must rebuild even when packet ids/times otherwise match', async change => {
  const state = await setup(`input-${change}`);
  try {
    const accepted = state.screen.dayModel;
    const original = state.fixture.history.readDay;
    state.read.mockImplementation(async args => {
      const answer = await original(args);
      if (change === 'deletion') return { ...answer, rows: answer.rows.slice(1) };
      if (change === 'own-undefined') return { ...answer, rows: answer.rows.map((row, i) => i ? row : { ...row, raw_speed_kmh: undefined }) };
      return { ...answer, seed: [{ time: state.fixture.now - 86400001, latitude: 1, longitude: 2, satellites: 9, hdop: 1 }] };
    });
    state.ledger.dataRevision++; state.ledger.publishedRevision += 2; await state.update();
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.dayModel).not.toBe(accepted);
  } finally { await state.close(); }
});
test.each(['changed', 'unknown', 'new-generation', 'new-publication-scope', 'new-publication-owner'])('%s publication: only the same publisher keeps today\'s verified model while fresh proof waits', async mode => {
  const state = await setup(mode); const wait = deferred();
  try {
    const accepted = state.screen.dayModel;
    expect(accepted).not.toBeNull(); state.hold(wait);
    if (['changed', 'unknown'].includes(mode)) state.ledger.publishedRevision = 2;
    if (mode === 'changed') state.ledger.dataRevision++;
    if (mode === 'unknown') state.ledger.dataRevision = null;
    if (mode === 'new-generation') state.ledger.generation++;
    if (mode === 'new-publication-scope') state.ledger.scope = {};
    if (mode === 'new-publication-owner') state.ledger.owner = 'b';
    await state.update();
    // Same account/publisher/generation: the verified view stays (no new build).
    if (['changed', 'unknown'].includes(mode)) expect(state.screen.dayModel).toBe(accepted);
    else expect(state.screen.dayModel).toBeNull();
    await act(async () => wait.resolve());
    if (mode === 'new-publication-owner') expect(state.screen.dayModel).toBeNull();
    else expect(state.screen.dayModel).not.toBeNull();
  } finally { wait.resolve(); await state.close(); }
});
test('fresh proof failure removes retained complete model; a later physical refresh can recover', async () => {
  const state = await setup('failure');
  const original = state.database.historyDownloadStates;
  try {
    expect(state.screen.dayModel).not.toBeNull();
    state.database.historyDownloadStates = async () => { throw new Error('SQLite proof unavailable'); };
    state.ledger.publishedRevision = 2; await state.update();
    expect(state.screen.dayModel).toBeNull(); expect(state.screen.map).toBeNull();
    // Avoid invoking manual download in this offline UI; retry the real proof.
    state.database.historyDownloadStates = original;
    state.ledger.publishedRevision = 4; await state.update();
    expect(state.screen.dayModel).not.toBeNull();
  } finally { await state.close(); }
});
test('fresh durable incomplete proof closes a formerly complete model despite unchanged row token', async () => {
  const state = await setup('proof-invalidated'); const wait = deferred();
  try {
    const accepted = state.screen.dayModel; state.hold(wait);
    await state.database.setHistoryDownloadState('a', state.dog, state.day, false);
    state.ledger.publishedRevision = 2; await state.update();
    expect(state.screen.dayModel).toBe(accepted);
    await act(async () => wait.resolve());
    expect(state.screen.dayModel).toBeNull(); expect(state.screen.map).toBeNull();
  } finally { wait.resolve(); await state.close(); }
});
// Rule change (PR #114): an open today view keeps its last verified model
// while an archive cutoff extension waits for the extended proof. The model
// is complete as of its own cutoff; no model is built from the shorter proof.
test('today archive cutoff extension keeps the last verified model until the extended proof arrives', async () => {
  const state = await setup('cutoff'); const wait = deferred();
  try {
    const accepted = state.screen.dayModel, verifiedAt = state.fixture.now;
    expect(accepted).not.toBeNull(); state.hold(wait);
    state.fixture.now += 1000; state.ledger.archiveCutoff = state.fixture.now; state.ledger.publishedRevision = 2;
    await state.update(); expect(state.screen.dayModel).toBe(accepted); expect(state.screen.loading).toBe(false);
    await act(async () => wait.resolve());
    // The stored proof still only covers the old cutoff: keep, never rebuild.
    expect(state.screen.dayModel).toBe(accepted);
    expect(state.screen.asOf === null || state.screen.asOf === verifiedAt).toBe(true);
    const bounds = dayBounds(state.day); state.hold(null);
    await state.database.setHistoryDownloadState('a', state.dog, state.day, true,
      historyCoverage(bounds.dayStart, bounds.dayEnd, state.fixture.now));
    state.ledger.publishedRevision = 4; await state.update();
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.loading).toBe(false);
  } finally { wait.resolve(); await state.close(); }
});
test.each(['withdrawn', 'new-generation', 'new-publication-owner', 'new-publication-scope'])('today cutoff extension with a %s proof shows loading, not the retained model', async mode => {
  const state = await setup(`cutoff-${mode}`); const wait = deferred();
  try {
    expect(state.screen.dayModel).not.toBeNull();
    if (mode === 'withdrawn') await state.database.setHistoryDownloadState('a', state.dog, state.day, false);
    else state.hold(wait);
    state.fixture.now += 1000; state.ledger.archiveCutoff = state.fixture.now; state.ledger.publishedRevision = 2;
    if (mode === 'new-generation') state.ledger.generation++;
    if (mode === 'new-publication-owner') state.ledger.owner = 'b';
    if (mode === 'new-publication-scope') state.ledger.scope = {};
    await state.update(); await act(async () => wait.resolve());
    expect(state.screen.dayModel).toBeNull(); expect(state.screen.map).toBeNull();
    if (mode === 'withdrawn') expect(state.screen.loading).toBe(true);
  } finally { wait.resolve(); await state.close(); }
});
test('a range drag while today re-reads shows the busy state, never the retained model; release shows the new range (PR 115)', async () => {
  const state = await setup('range-drag'); const wait = deferred();
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  try {
    const accepted = state.screen.dayModel, map = state.screen.map, before = state.screen.range;
    expect(accepted).not.toBeNull();
    state.hold(wait); state.ledger.dataRevision++; state.ledger.publishedRevision += 2; await state.update();
    expect(state.screen.dayModel).toBe(accepted); expect(state.screen.map).toBe(map);
    // The finger moves a handle: the busy state replaces the retained view.
    await act(async () => state.screen.beginRangeDrag());
    expect(state.screen.rangePending).toBe(true);
    expect(state.screen.dayModel).toBeNull(); expect(state.screen.map).toBeNull(); expect(state.screen.loading).toBe(true);
    const start = before.start + 10 * 60000;
    await act(async () => state.screen.commitRange({ start, end: null, following: true }));
    await settle();
    // Released while the proof still re-reads: the old range's model is not shown for the new range.
    expect(state.screen.rangePending).toBe(false);
    expect(state.screen.dayModel).not.toBe(accepted);
    await act(async () => wait.resolve()); await settle();
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.dayModel).not.toBe(accepted);
    expect(state.screen.range.start).toBeGreaterThanOrEqual(start - 60000);
    expect(state.screen.loading).toBe(false);
  } finally { wait.resolve(); await state.close(); }
});
test('after a released range, the next archive pass keeps that range\'s model, not the pre-drag one (PR 115)', async () => {
  const state = await setup('range-then-pass'); const wait = deferred();
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  try {
    const before = state.screen.range;
    await act(async () => state.screen.beginRangeDrag());
    await act(async () => state.screen.commitRange({ start: before.start + 10 * 60000, end: null, following: true }));
    await settle();
    const released = state.screen.dayModel;
    expect(released).not.toBeNull();
    state.hold(wait); state.ledger.dataRevision++; state.ledger.publishedRevision += 2; await state.update();
    expect(state.screen.dayModel).toBe(released); expect(state.screen.loading).toBe(false);
  } finally { wait.resolve(); await state.close(); }
});
