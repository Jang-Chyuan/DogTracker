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
test.each(['changed', 'unknown', 'new-generation', 'new-publication-scope', 'new-publication-owner'])('%s publication cannot retain the old complete model while fresh proof waits', async mode => {
  const state = await setup(mode); const wait = deferred();
  try {
    expect(state.screen.dayModel).not.toBeNull(); state.hold(wait);
    if (['changed', 'unknown'].includes(mode)) state.ledger.publishedRevision = 2;
    if (mode === 'changed') state.ledger.dataRevision++;
    if (mode === 'unknown') state.ledger.dataRevision = null;
    if (mode === 'new-generation') state.ledger.generation++;
    if (mode === 'new-publication-scope') state.ledger.scope = {};
    if (mode === 'new-publication-owner') state.ledger.owner = 'b';
    await state.update(); expect(state.screen.dayModel).toBeNull();
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
test('today archive cutoff extension never keeps a previous proof while the new target waits', async () => {
  const state = await setup('cutoff'); const wait = deferred();
  try {
    expect(state.screen.dayModel).not.toBeNull(); state.hold(wait);
    state.fixture.now += 1000; state.ledger.archiveCutoff = state.fixture.now; state.ledger.publishedRevision = 2;
    await state.update(); expect(state.screen.dayModel).toBeNull();
    await act(async () => wait.resolve());
    // The old proof only covers the old cutoff, even though rows did not change.
    expect(state.screen.dayModel).toBeNull();
  } finally { wait.resolve(); await state.close(); }
});
