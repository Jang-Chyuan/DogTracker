import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
import { SKELETON_TIMING } from '../src/components/Skeleton';
import { t } from '../src/i18n';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test.each(['complete', 'incomplete', 'read-error'])('retained local rows with deferred real durable %s proof show reading until the result is known', async outcome => {
  jest.useFakeTimers();
  const connection = createMemoryConnection(), wait = deferred();
  let renderer;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection); await database.initialize();
    const fixture = buildFixture('history-dog');
    const target = historyTargetOf(fixture.history.preferences);
    const day = dayKey(new Date(fixture.now)), bounds = dayBounds(day);
    await database.setHistoryDownloadState('pending-owner', target.slaveId, day, outcome !== 'incomplete',
      historyCoverage(bounds.dayStart, bounds.dayEnd, fixture.now));
    const readProof = database.historyDownloadStates;
    database.historyDownloadStates = jest.fn(async (...args) => {
      await wait.promise;
      if (outcome === 'read-error') throw new Error('proof database read failed');
      return readProof(...args);
    });
    const ledger = { scope: {}, owner: 'pending-owner', generation: 1, publishedPending: false,
      publishedRevision: 0, dataRevision: 0 };
    const cloud = createHistoryCloud({ client: { from: () => { throw new Error('unexpected network'); } },
      database, owner: 'pending-owner', getPublication: () => ledger });
    const download = jest.spyOn(cloud, 'download');
    const read = jest.fn(fixture.history.readDay), clock = () => fixture.now;
    let screen;
    function Probe() {
      screen = useHistoryScreen({ target, owner: 'pending-owner', cloud, read,
        readDays: fixture.history.readDays, clock, online: false, publicationRevision: 0,
        memoryScope: `proof-ui-${outcome}` });
      return <HistoryScreen screen={screen} top={24} bottomInset={0} name="QA" />;
    }
    const has = id => renderer.root.findAll(n => n.props.testID === id).length > 0;
    const exportDisabled = () => renderer.root.findAll(n => n.props.testID === 'history-export'
      && n.props.accessibilityState)[0].props.accessibilityState.disabled;
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => jest.advanceTimersByTimeAsync(SKELETON_TIMING.delay));
    const answers = await Promise.all(read.mock.results.map(result => result.value));
    expect(answers.some(answer => answer.rows.length > 0)).toBe(true);
    expect(database.historyDownloadStates).toHaveBeenCalled();
    expect(screen.dayModel).toBeNull(); expect(screen.map).toBeNull();
    expect(exportDisabled()).toBe(true);
    expect(has('history-unfinished')).toBe(false);
    expect(has('history-download-retry')).toBe(false);
    expect(has('history-skeleton')).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain(t('c424'));
    expect(download).not.toHaveBeenCalled();
    await act(async () => wait.resolve());
    expect(has('history-skeleton')).toBe(false);
    if (outcome === 'complete') {
      expect(screen.dayModel).not.toBeNull(); expect(screen.map).not.toBeNull();
      expect(has('history-unfinished')).toBe(false); expect(exportDisabled()).toBe(false);
    } else {
      // A genuine incomplete result or accepted read failure must settle into
      // retry, not retain an endless reading state or expose unproved rows.
      expect(screen.dayModel).toBeNull(); expect(screen.map).toBeNull();
      expect(has('history-unfinished')).toBe(true);
      expect(has('history-download-retry')).toBe(true); expect(exportDisabled()).toBe(true);
      expect(JSON.stringify(renderer.toJSON())).toContain(t('c321'));
    }
  } finally {
    wait.resolve();
    if (renderer) await act(async () => renderer.unmount());
    connection.close(); jest.useRealTimers();
  }
});
