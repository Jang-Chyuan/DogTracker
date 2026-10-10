import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
import { historyCoverage } from '../src/cloud/HistoryCoverage';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixtureHarness(cloud, scope = 'coverage-screen') {
  const fixture = buildFixture('history-dog');
  let screen;
  const clock = () => fixture.now;
  const read = jest.fn(fixture.history.readDay);
  const Probe = ({ owner = 'owner-a', active = true, publicationRevision = 0 }) => {
    screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), owner,
      cloud, read, readDays: fixture.history.readDays, clock, active, publicationRevision, memoryScope: scope });
    return null;
  };
  return { fixture, read, Probe, get screen() { return screen; } };
}
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
