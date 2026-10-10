import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { t } from '../src/i18n';
import { SKELETON_TIMING } from '../src/components/Skeleton';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixtureHarness(cloud, scope = 'coverage-screen') {
  const fixture = buildFixture('history-dog');
  let screen;
  const clock = () => fixture.now;
  const read = jest.fn(fixture.history.readDay);
  const Probe = ({ owner = 'owner-a', active = true, publicationRevision = 0, renderUI = false }) => {
    screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), owner,
      cloud, read, readDays: fixture.history.readDays, clock, active, publicationRevision, memoryScope: scope });
    return renderUI ? <HistoryScreen screen={screen} top={24} bottomInset={0} name="QA" /> : null;
  };
  return { fixture, read, Probe, get screen() { return screen; } };
}
test.each(['cancel', 'failure'])('legacy local rows without proof: UI %s, failed retry, then completed retry stay exclusive', async terminal => {
  jest.useFakeTimers();
  const first = deferred(), second = deferred(), third = deferred();
  let durable = [];
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => durable,
    download: jest.fn().mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise).mockImplementationOnce(() => third.promise) };
  const state = fixtureHarness(cloud, `coverage-ui-legacy-${terminal}`);
  let renderer;
  const text = () => JSON.stringify(renderer.toJSON());
  const has = id => renderer.root.findAll(node => node.props.testID === id).length > 0;
  const exportDisabled = () => renderer.root.findAll(node => node.props.testID === 'history-export'
    && node.props.accessibilityState)[0].props.accessibilityState.disabled;
  const press = async id => {
    const node = renderer.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0];
    if (!node) throw new Error(`missing UI action: ${id}`);
    await act(async () => node.props.onPress());
  };
  const incomplete = () => {
    expect(state.screen.dayModel).toBeNull();
    expect(state.screen.map).toBeNull();
    expect(has('history-unfinished')).toBe(true);
    expect(has('history-skeleton')).toBe(false);
    expect(has('history-empty')).toBe(false);
    expect(exportDisabled()).toBe(true);
    expect(text()).toContain(t('c321'));
    expect(text()).not.toContain(t('c424'));
    expect(text()).not.toContain(t('c1253'));
  };
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe renderUI />); });
    await act(async () => jest.advanceTimersByTimeAsync(SKELETON_TIMING.delay));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    // The production hook has really read retained local records, not an empty
    // fixture or an injected prebuilt model. Their missing proof closes the UI.
    const returned = await Promise.all(state.read.mock.results.map(result => result.value));
    expect(returned.some(result => result.rows.length > 0)).toBe(true);
    expect(state.screen.dayModel).toBeNull();
    expect(has('history-skeleton')).toBe(true);
    expect(exportDisabled()).toBe(true);
    expect(text()).toContain(t('c1253'));
    expect(text()).not.toContain('只有雲端有，正在下載');
    if (terminal === 'cancel') {
      await press('history-download-cancel');
      incomplete();
      expect(cloud.download.mock.calls[0][0].signal.aborted).toBe(true);
    }
    await act(async () => first.reject(new Error('download stopped')));
    incomplete();
    expect(cloud.download).toHaveBeenCalledTimes(1);
    await press('history-download-retry');
    await act(async () => jest.advanceTimersByTimeAsync(SKELETON_TIMING.delay));
    expect(cloud.download).toHaveBeenCalledTimes(2);
    expect(has('history-skeleton')).toBe(true);
    expect(has('history-unfinished')).toBe(false);
    expect(exportDisabled()).toBe(true);
    expect(text()).toContain(t('c1253'));
    await act(async () => second.reject(new Error('retry failed')));
    incomplete();
    expect(cloud.download).toHaveBeenCalledTimes(2);
    await press('history-download-retry');
    const request = cloud.download.mock.calls[2][0];
    durable = [{ slave_id: request.slaveId, day: state.screen.dayKey, complete: 1,
      ...historyCoverage(request.dayStart, request.dayEnd, request.cutoff) }];
    await act(async () => third.resolve(0));
    expect(cloud.download).toHaveBeenCalledTimes(3);
    expect(state.screen.model.dayRecords).toBe(true);
    expect(state.screen.map).not.toBeNull();
    expect(has('history-skeleton')).toBe(false);
    expect(has('history-unfinished')).toBe(false);
    expect(exportDisabled()).toBe(false);
    expect(text()).not.toContain(t('c424'));
    expect(text()).not.toContain(t('c321'));
    expect(text()).not.toContain(t('c1253'));
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});
test.each(['failure', 'cancel'])('partial local day auto-ensures, and %s exposes no route or export model', async terminal => {
  const job = deferred();
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => [], download: jest.fn(() => job.promise) };
  const state = fixtureHarness(cloud, `coverage-${terminal}`);
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(state.screen.dayModel).toBeNull();
    expect(state.screen.map).toBeNull();
    if (terminal === 'cancel') await act(async () => state.screen.cancelDownload());
    await act(async () => job.reject(new Error('network stopped')));
    expect(state.screen.dayModel).toBeNull();
    expect(state.screen.map).toBeNull();
    expect(cloud.download).toHaveBeenCalledTimes(1);
  } finally { await act(async () => renderer.unmount()); }
});
test('successful ensure rereads through its finite cutoff and publishes one complete history model', async () => {
  const job = deferred();
  let durable = [];
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => durable, download: jest.fn(() => job.promise) };
  const state = fixtureHarness(cloud, 'coverage-success');
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    const request = cloud.download.mock.calls[0][0];
    expect(request.cutoff).toBe(state.fixture.now);
    expect(state.screen.dayModel).toBeNull();
    durable = [{ slave_id: request.slaveId, day: state.screen.dayKey, complete: 1, ...historyCoverage(request.dayStart, request.dayEnd, request.cutoff) }];
    await act(async () => job.resolve(0));
    expect(state.screen.dayModel).not.toBeNull();
    expect(state.screen.map).not.toBeNull();
    expect(state.read.mock.calls.every(([args]) => args.end <= request.cutoff)).toBe(true);
    expect(cloud.download).toHaveBeenCalledTimes(1);
  } finally { await act(async () => renderer.unmount()); }
});
test('complete empty coverage is ready without network download or endless loading', async () => {
  const cloud = { owner: 'owner-a', coverageRequired: true, download: jest.fn() };
  const state = fixtureHarness(cloud, 'coverage-empty');
  const day = dayKey(new Date(state.fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(state.fixture.history.preferences).slaveId;
  cloud.downloadStates = async () => [{ slave_id: dog, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, state.fixture.now) }];
  // Empty server result is independently completed, not inferred from rows.
  state.fixture.history.readDay = async () => ({ rows: [], after: {} });
  state.read.mockImplementation(state.fixture.history.readDay);
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    expect(cloud.download).not.toHaveBeenCalled();
    expect(state.screen.dayModel).not.toBeNull();
    expect(state.screen.dayModel.subjects.every(s => !s.hasData)).toBe(true);
    expect(state.screen.loading).toBe(false);
  } finally { await act(async () => renderer.unmount()); }
});

test('replaced account ignores old successful ensure and only the new account can publish', async () => {
  const first = deferred(), second = deferred();
  let durable = [], activeOwner = 'owner-a';
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => durable,
    download: jest.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise) };
  const state = fixtureHarness(cloud, 'coverage-replaced-account');
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe owner={activeOwner} />); });
    const old = cloud.download.mock.calls[0][0];
    activeOwner = 'owner-b';
    cloud.owner = activeOwner;
    await act(async () => renderer.update(<state.Probe owner={activeOwner} />));
    expect(cloud.download).toHaveBeenCalledTimes(2);
    expect(old.signal.aborted).toBe(true);
    await act(async () => first.resolve(0));
    expect(state.screen.dayModel).toBeNull();
    const request = cloud.download.mock.calls[1][0];
    durable = [{ slave_id: request.slaveId, day: state.screen.dayKey, complete: 1, ...historyCoverage(request.dayStart, request.dayEnd, request.cutoff) }];
    await act(async () => second.resolve(0));
    expect(state.screen.dayModel).not.toBeNull();
  } finally { await act(async () => renderer.unmount()); }
});
test('adding a second dog never publishes the first completed dog as a partial group', async () => {
  const first = deferred(), second = deferred();
  let durable = [];
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => durable,
    download: jest.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise) };
  const state = fixtureHarness(cloud, 'coverage-added-dog');
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    const original = cloud.download.mock.calls[0][0];
    const originalId = original.slaveId;
    await act(async () => state.screen.addDog({ id: 99, hasData: true }));
    expect(original.signal.aborted).toBe(true);
    expect(cloud.download).toHaveBeenCalledTimes(2);
    const request = cloud.download.mock.calls[1][0];
    expect(request.slaveId).toEqual([originalId, 99]);
    const proof = historyCoverage(request.dayStart, request.dayEnd, request.cutoff);
    durable = [{ slave_id: originalId, day: state.screen.dayKey, complete: 1, ...proof }];
    await act(async () => request.onDogEnd(originalId, 'done'));
    expect(state.screen.dayModel).toBeNull();
    expect(state.screen.map).toBeNull();
    durable.push({ slave_id: 99, day: state.screen.dayKey, complete: 1, ...proof });
    await act(async () => { request.onDogEnd(99, 'done'); second.resolve(0); });
    expect(state.screen.dayModel.subjects.map(s => s.id)).toEqual([originalId, 99]);
  } finally { await act(async () => renderer.unmount()); }
});

test('a new archive publication cannot expose rows before its new coverage proof resolves', async () => {
  const nextProof = deferred(), download = deferred();
  const cloud = { owner: 'owner-a', coverageRequired: true, download: jest.fn(() => download.promise) };
  const state = fixtureHarness(cloud, 'coverage-publication-race');
  const day = dayKey(new Date(state.fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(state.fixture.history.preferences).slaveId;
  const proof = { slave_id: dog, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, state.fixture.now) };
  cloud.downloadStates = jest.fn().mockResolvedValueOnce([proof]).mockImplementationOnce(() => nextProof.promise);
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    expect(state.screen.dayModel).not.toBeNull();
    await act(async () => renderer.update(<state.Probe publicationRevision={1} />));
    expect(state.screen.dayModel).toBeNull();
    expect(state.screen.map).toBeNull();
    expect(cloud.download).not.toHaveBeenCalled();
    await act(async () => nextProof.resolve([{ ...proof, complete: 0 }]));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(state.screen.dayModel).toBeNull();
  } finally { await act(async () => renderer.unmount()); }
});

test('foreground during an old-cutoff download ensures the new today tail after the old job finishes', async () => {
  const first = deferred(), tail = deferred();
  let durable = [];
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => durable,
    download: jest.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => tail.promise) };
  const state = fixtureHarness(cloud, 'coverage-foreground-tail');
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    const initial = cloud.download.mock.calls[0][0];
    await act(async () => renderer.update(<state.Probe active={false} />));
    state.fixture.now += 60000;
    await act(async () => renderer.update(<state.Probe active />));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    durable = [{ slave_id: initial.slaveId, day: state.screen.dayKey, complete: 1, ...historyCoverage(initial.dayStart, initial.dayEnd, initial.cutoff) }];
    await act(async () => first.resolve(0));
    expect(cloud.download).toHaveBeenCalledTimes(2);
    expect(cloud.download.mock.calls[1][0].cutoff).toBe(state.fixture.now);
    expect(state.screen.dayModel).toBeNull();
  } finally { await act(async () => renderer.unmount()); }
});
test('explicitly reselecting a cancelled selected day retries its ensure', async () => {
  const first = deferred(), retry = deferred();
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => [],
    download: jest.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retry.promise) };
  const state = fixtureHarness(cloud, 'coverage-reselect-cancelled');
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    await act(async () => state.screen.cancelDownload());
    await act(async () => first.reject(new Error('cancelled')));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    await act(async () => state.screen.goTo(state.screen.dayKey));
    expect(cloud.download).toHaveBeenCalledTimes(2);
    expect(state.screen.dayModel).toBeNull();
  } finally { await act(async () => renderer.unmount()); }
});

test('automatic archive cutoff safely advances an open today view; manual publication does not loop tails', async () => {
  const job = deferred();
  const ledger = { archiveCutoff: null, owner: 'owner-a', scope: {}, generation: 1, publishedRevision: 0, publishedPending: false };
  let durable = [];
  const cloud = { owner: 'owner-a', coverageRequired: true, publishedReads: true, getPublication: () => ledger,
    downloadStates: async () => durable, download: jest.fn(() => job.promise) };
  const state = fixtureHarness(cloud, 'coverage-auto-archive-tail');
  const day = dayKey(new Date(state.fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(state.fixture.history.preferences).slaveId;
  durable = [{ slave_id: dog, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, state.fixture.now) }];
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    expect(cloud.download).not.toHaveBeenCalled();
    expect(state.screen.dayModel).not.toBeNull();
    state.fixture.now += 120000; ledger.archiveCutoff = state.fixture.now;
    await act(async () => renderer.update(<state.Probe publicationRevision={1} />));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(state.screen.dayModel).toBeNull();
    const request = cloud.download.mock.calls[0][0];
    expect(request.cutoff).toBe(ledger.archiveCutoff);
    durable = [{ slave_id: dog, day, complete: 1, ...historyCoverage(request.dayStart, request.dayEnd, request.cutoff) }];
    await act(async () => job.resolve(0));
    await act(async () => renderer.update(<state.Probe publicationRevision={2} />));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(state.screen.dayModel).not.toBeNull();
  } finally { await act(async () => renderer.unmount()); }
});

test('a frozen completed today view labels its as-of time and updates only on explicit request', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  let durable = [];
  const cloud = { owner: 'owner-a', coverageRequired: true,
    downloadStates: async () => durable, download: jest.fn(() => pending.promise) };
  const state = fixtureHarness(cloud, 'coverage-as-of-label');
  const cutoff = state.fixture.now, day = dayKey(new Date(cutoff)), bounds = dayBounds(day);
  const dog = historyTargetOf(state.fixture.history.preferences).slaveId;
  durable = [{ slave_id: dog, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, cutoff) }];
  let renderer, ui;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe />); });
    state.fixture.now += 60000;
    await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(cloud.download).not.toHaveBeenCalled();
    expect(state.screen.asOf).toBe(cutoff);
    await act(async () => { ui = Renderer.create(<HistoryScreen screen={state.screen} top={24}
      levels={{ summary: 140, half: 420, full: 620 }} bottomInset={0} name="QA" history={null} />); });
    expect(JSON.stringify(ui.toJSON())).toContain('截至');
    const update = ui.root.findAll(node => node.props.testID === 'history-update-tail' && typeof node.props.onPress === 'function')[0];
    await act(async () => update.props.onPress());
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(cloud.download.mock.calls[0][0].cutoff).toBe(state.fixture.now);
    expect(state.screen.dayModel).toBeNull();
  } finally {
    if (ui) await act(async () => ui.unmount());
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});
test('unchanged material publication revalidates proof and restores the full model without rereading history', async () => {
  const ledger = { scope: {}, owner: 'owner-a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 1 };
  const cloud = { owner: 'owner-a', coverageRequired: true, publishedReads: true, getPublication: () => ledger, download: jest.fn() };
  const state = fixtureHarness(cloud, 'coverage-material-unchanged');
  const day = dayKey(new Date(state.fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(state.fixture.history.preferences).slaveId;
  const delayedProof = deferred();
  cloud.downloadStates = jest.fn(async () => {
    if (ledger.publishedPending) await delayedProof.promise;
    return [{ slave_id: dog, day, complete: 1,
      ...historyCoverage(bounds.dayStart, bounds.dayEnd, state.fixture.now) }];
  });
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<state.Probe publicationRevision={0} />); });
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.map).not.toBeNull();
    const accepted = state.screen.dayModel;
    const reads = state.read.mock.calls.length, proofs = cloud.downloadStates.mock.calls.length;
    ledger.publishedPending = true; ledger.publishedRevision = 1;
    await act(async () => renderer.update(<state.Probe publicationRevision={1} />));
    expect(state.screen.dayModel).toBe(accepted);
    ledger.publishedPending = false; ledger.publishedRevision = 2;
    await act(async () => renderer.update(<state.Probe publicationRevision={2} />));
    expect(cloud.downloadStates.mock.calls.length).toBeGreaterThan(proofs);
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.map).not.toBeNull();
    expect(state.screen.dayModel).toBe(accepted);
    expect(state.screen.loading).toBe(false); expect(state.read).toHaveBeenCalledTimes(reads);
    expect(cloud.download).not.toHaveBeenCalled();
    await act(async () => delayedProof.resolve());
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
