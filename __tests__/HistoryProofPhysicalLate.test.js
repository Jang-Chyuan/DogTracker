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

test('a late complete proof cannot cross physical publication before React cleans up its read', async () => {
  const connection = createMemoryConnection();
  let renderer, release, releaseFresh;
  const held = new Promise(resolve => { release = resolve; });
  const freshHeld = new Promise(resolve => { releaseFresh = resolve; });
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    const fixture = buildFixture('history-dog');
    const target = historyTargetOf(fixture.history.preferences);
    const day = dayKey(new Date(fixture.now));
    const bounds = dayBounds(day);
    await database.setHistoryDownloadState('a', target.slaveId, day, true,
      historyCoverage(bounds.dayStart, bounds.dayEnd, fixture.now));
    const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false,
      publishedRevision: 0, dataRevision: 0 };
    const readProof = database.historyDownloadStates;
    let capturedProof;
    database.historyDownloadStates = jest.fn(async (...args) => {
      const rows = await readProof(...args);
      if (!capturedProof) {
        capturedProof = rows;
        await held;
      } else {
        await freshHeld;
      }
      return rows;
    });
    const cloud = createHistoryCloud({ database, owner: 'a', getPublication: () => ledger,
      client: { from: () => { throw new Error('unexpected network'); } } });
    const read = jest.fn(fixture.history.readDay);
    const clock = () => fixture.now;
    let screen;
    function Probe() {
      screen = useHistoryScreen({ target, owner: 'a', cloud, read,
        readDays: fixture.history.readDays, clock, online: false,
        publicationRevision: ledger.publishedRevision, memoryScope: 'physical-late-proof' });
      return null;
    }
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(capturedProof).toEqual([expect.objectContaining({ complete: 1 })]);
    expect(read.mock.calls.length).toBeGreaterThan(0);
    expect(screen.dayModel).toBeNull();

    // Native publication is visible through the scheduler getter before its
    // React update/cleanup. The held query already captured the old SQL proof.
    ledger.publishedRevision = 2;
    await database.setHistoryDownloadState('a', target.slaveId, day, false);
    await act(async () => release());
    expect(screen.dayModel).toBeNull();
    expect(screen.map).toBeNull();

    await act(async () => renderer.update(<Probe />));
    expect(database.historyDownloadStates).toHaveBeenCalledTimes(2);
    await act(async () => releaseFresh());
    expect(screen.dayModel).toBeNull();
    expect(screen.map).toBeNull();
    expect((await readProof('a', target.slaveId))[0].complete).toBe(0);
  } finally {
    release();
    releaseFresh();
    if (renderer) await act(async () => renderer.unmount());
    connection.close();
  }
});
