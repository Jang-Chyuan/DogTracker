import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { DAY_STEP_SETTLE_MAX_MS, historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
import { ScrollView } from 'react-native';
import HistoryScreen from '../src/mapHistory/HistoryScreen';

// Another day than today, as opened with ‹ › or the calendar: an archive
// publish only moves the global data revision (it added today's rows), the
// day's proof and rows read back unchanged. The verified view stays; it is
// replaced only when that re-read actually finds something else.
const DAY_MS = 86400000;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(suffix, { fixtureName = 'history-dog', extraDogs = [], ledger: extra = {}, opensToday = false,
  online = false, extraDays = [] } = {}) {
  const connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection); await database.initialize();
  const fixture = buildFixture(fixtureName);
  const day = dayKey(new Date(fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(fixture.history.preferences).slaveId;
  const dogs = [dog, ...extraDogs];
  // The whole past day is proven (its two hours of late uploads included).
  for (const id of dogs) await database.setHistoryDownloadState('a', id, day, true,
    historyCoverage(bounds.dayStart, bounds.dayEnd, bounds.dayEnd + 3 * 3600000));
  const ledger = { scope: {}, owner: 'a', generation: 1, lineage: 1, latestReadReady: true,
    publishedPending: false, publishedRevision: 0, dataRevision: 0, ...extra };
  const readProof = database.historyDownloadStates;
  let hold = null;
  database.historyDownloadStates = jest.fn(async (...args) => { if (hold) await hold.promise; return readProof(...args); });
  const cloud = createHistoryCloud({ client: { from: () => { throw new Error('unexpected network'); } }, database,
    owner: 'a', getPublication: () => ledger });
  const read = jest.fn(fixture.history.readDay);
  // Two days later: the fixture's day is a past day.
  let now = fixture.now + (opensToday ? 0 : 2 * DAY_MS);
  const clock = () => now;
  const restore = { key: `past-${suffix}`, day: bounds.dayStart, selection: { subject: 'dog',
    dogs: dogs.map((id, slot) => ({ id, slot, colour: '#000000', hasData: true })), protagonist: dog, rangeOwner: dog, kept: null } };
  const readDays = async args => [...new Set([...await fixture.history.readDays(args), ...extraDays])].sort();
  let screen, active = true;
  const seen = [];
  function Probe() {
    screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), owner: 'a', cloud, read,
      readDays, clock, online, active, restore: opensToday ? null : restore,
      publicationRevision: ledger.publishedRevision, memoryScope: `past-${suffix}` });
    seen.push({ loading: screen.loading, model: screen.dayModel });
    return null;
  }
  let renderer; await act(async () => { renderer = Renderer.create(<Probe />); });
  const update = async () => act(async () => renderer.update(<Probe />));
  return { ledger, database, cloud, read, day, dog, dogs, fixture, seen, clock, get screen() { return screen; },
    hold: value => { hold = value; }, update, setActive: value => { active = value; }, advance: ms => { now += ms; },
    close: async () => { await act(async () => renderer.unmount()); connection.close(); } };
}
const publishOtherDay = state => { state.ledger.dataRevision++; state.ledger.publishedRevision += 2; };

test('a past day keeps its verified model through an archive publish that did not touch it, and reuses it exactly', async () => {
  const state = await setup('unchanged'); const wait = deferred();
  try {
    expect(state.screen.today).toBe(false);
    const accepted = state.screen.dayModel, map = state.screen.map, reads = state.read.mock.calls.length;
    expect(accepted).not.toBeNull();
    state.seen.length = 0; state.hold(wait); publishOtherDay(state); await state.update();
    // The proof re-read waits: the verified view, not loading.
    expect(state.screen.dayModel).toBe(accepted); expect(state.screen.map).toBe(map);
    expect(state.screen.loading).toBe(false); expect(state.screen.asOf).toBeNull();
    await act(async () => wait.resolve());
    // Re-read (proof and rows), found unchanged: the very same model.
    expect(state.read.mock.calls.length).toBeGreaterThan(reads);
    expect(state.screen.dayModel).toBe(accepted);
    expect(state.seen.every(value => !value.loading && value.model === accepted)).toBe(true);
  } finally { wait.resolve(); await state.close(); }
});

test('a past day whose rows did change is rebuilt from the re-read, without a loading step', async () => {
  const state = await setup('changed'); const rows = deferred();
  try {
    const accepted = state.screen.dayModel;
    expect(accepted).not.toBeNull();
    const original = state.fixture.history.readDay;
    state.read.mockImplementation(async args => { await rows.promise; const answer = await original(args);
      return { ...answer, rows: answer.rows.slice(1) }; });
    state.seen.length = 0; publishOtherDay(state); await state.update();
    expect(state.screen.dayModel).toBe(accepted); expect(state.screen.loading).toBe(false);
    await act(async () => rows.resolve());
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.dayModel).not.toBe(accepted);
    expect(state.seen.some(value => value.loading)).toBe(false);
  } finally { rows.resolve(); await state.close(); }
});

test('a past day whose proof the publish withdrew shows loading once the proof is read', async () => {
  const state = await setup('withdrawn'); const wait = deferred();
  try {
    const accepted = state.screen.dayModel;
    expect(accepted).not.toBeNull();
    state.hold(wait);
    await state.database.setHistoryDownloadState('a', state.dog, state.day, false);
    publishOtherDay(state); await state.update();
    expect(state.screen.dayModel).toBe(accepted);
    await act(async () => wait.resolve());
    expect(state.screen.dayModel).toBeNull(); expect(state.screen.map).toBeNull(); expect(state.screen.loading).toBe(true);
  } finally { wait.resolve(); await state.close(); }
});

test.each(['new-lineage', 'new-publication-owner'])('a past day with a %s publication is not kept', async mode => {
  const state = await setup(`identity-${mode}`); const wait = deferred();
  try {
    expect(state.screen.dayModel).not.toBeNull();
    state.hold(wait);
    if (mode === 'new-lineage') { state.ledger.generation++; state.ledger.lineage++; }
    else state.ledger.owner = 'b';
    publishOtherDay(state); await state.update();
    expect(state.screen.dayModel).toBeNull(); expect(state.screen.loading).toBe(true);
  } finally { wait.resolve(); await state.close(); }
});

test('several dogs on a past day: the verified view stays until every dog is re-read, never one dog alone', async () => {
  const state = await setup('multi', { fixtureName: 'history-multi-dog', extraDogs: [4] });
  const slow = deferred();
  try {
    const accepted = state.screen.dayModel;
    expect(accepted?.subjects.map(s => s.id).sort()).toEqual([...state.dogs].sort());
    const original = state.fixture.history.readDay;
    state.read.mockImplementation(async args => {
      if (args.slaveId === 4) await slow.promise;
      const answer = await original(args);
      // The other dog's rows changed: its re-read finishes first.
      return args.slaveId === 4 ? answer : { ...answer, rows: answer.rows.slice(1) };
    });
    state.seen.length = 0; publishOtherDay(state); await state.update();
    await act(async () => { await Promise.resolve(); });
    expect(state.screen.dayModel).toBe(accepted);
    expect(state.seen.every(value => value.model === accepted)).toBe(true);
    await act(async () => slow.resolve());
    expect(state.screen.dayModel).not.toBe(accepted);
    expect(state.screen.dayModel.subjects.map(s => s.id).sort()).toEqual([...state.dogs].sort());
    expect(state.seen.some(value => value.loading)).toBe(false);
  } finally { slow.resolve(); await state.close(); }
});

test('a foreground return keeps a past day\'s verified view until the new generation reads it again', async () => {
  const state = await setup('resume');
  try {
    const accepted = state.screen.dayModel;
    expect(accepted).not.toBeNull();
    state.setActive(false); state.ledger.generation++; await state.update();
    state.advance(5 * 60000);
    state.ledger.generation++; state.ledger.latestReadReady = false;
    state.seen.length = 0; state.setActive(true); await state.update();
    expect(state.screen.dayModel).toBe(accepted); expect(state.screen.loading).toBe(false);
    expect(state.screen.asOf).toBeNull();
    state.ledger.latestReadReady = true; state.ledger.publishedRevision += 2; await state.update();
    expect(state.screen.dayModel).not.toBeNull(); expect(state.screen.loading).toBe(false);
    expect(state.seen.some(value => value.loading)).toBe(false);
  } finally { await state.close(); }
});

// 「下載 X 的紀錄…」 at once for a day the screen already knows needs it (the
// proof just read leaves it incomplete, 「部分」), not a skeleton while the new
// day reads that same proof again first.
test('‹ › to a day already known to be incomplete shows its download at once, with the new day\'s cutoff', async () => {
  const fixture = buildFixture('history-dog');
  const yesterday = dayKey(new Date(fixture.now - DAY_MS));
  const state = await setup('go-to-partial', { opensToday: true, online: true, extraDays: [yesterday] });
  const wait = deferred(), running = deferred();
  try {
    expect(state.screen.today).toBe(true); expect(state.screen.dayModel).not.toBeNull();
    state.cloud.download = jest.fn(() => running.promise);
    expect(state.screen.navigation.previous).toBe(yesterday);
    // The new day's proof re-read would wait (an archive publishing, a resume).
    state.hold(wait); state.advance(60000);
    let choice;
    await act(async () => { choice = state.screen.previousDay(); });
    expect(choice.type).toBe('download');
    expect(state.screen.dayKey).toBe(yesterday);
    expect(state.screen.download?.kind).toBe('downloading');
    // Fetched once the taps settle on this day (another tap may still come).
    expect(state.cloud.download).not.toHaveBeenCalled();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, DAY_STEP_SETTLE_MAX_MS + 20)); });
    expect(state.screen.download?.kind).toBe('downloading');
    expect(state.cloud.download).toHaveBeenCalledTimes(1);
    const { dayStart, dayEnd, cutoff } = state.cloud.download.mock.calls[0][0];
    expect(dayStart).toBe(dayBounds(yesterday).dayStart); expect(dayEnd).toBe(dayBounds(yesterday).dayEnd);
    expect(cutoff).toBe(state.clock());
    await act(async () => wait.resolve());
    // The day's own check agrees: no second download.
    expect(state.cloud.download).toHaveBeenCalledTimes(1);
    expect(state.screen.download?.kind).toBe('downloading');
  } finally { wait.resolve(); running.resolve(); await state.close(); }
});

// The commit in which the proof answers 「not complete」 is already the
// download: never one frame of 「這天的紀錄還沒下載完　重試」 between the
// skeleton and 「下載 … 的紀錄」.
test('opening a day the proof leaves incomplete goes from reading straight to the download, no unfinished frame', async () => {
  const fixture = buildFixture('history-dog');
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => [],
    download: jest.fn(() => new Promise(() => {})) };
  const kinds = [];
  function Probe() {
    const screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), owner: 'owner-a', cloud,
      read: fixture.history.readDay, readDays: fixture.history.readDays, clock: () => fixture.now, memoryScope: 'no-unfinished-frame' });
    kinds.push(screen.download?.kind ?? 'reading');
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe />); });
  try {
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(kinds).toContain('downloading');
    expect(kinds.slice(0, kinds.indexOf('downloading')).every(kind => kind === 'reading')).toBe(true);
    expect(kinds).not.toContain('unfinished');
  } finally { await act(async () => renderer.unmount()); }
});

// Device 0.3.179: blank → 「下載 10/13 的紀錄…」 → skeleton alone → content
// read as three loading screens. Now: the skeleton from the first frame, the
// download line on it until the downloaded day is shown, then the content.
test('a dog day download: skeleton from the first frame, the download line stays until the content', async () => {
  const fixture = buildFixture('history-dog');
  const day = dayKey(new Date(fixture.now)), bounds = dayBounds(day);
  const dog = historyTargetOf(fixture.history.preferences).slaveId;
  let proof = [];
  const finish = deferred();
  const cloud = { owner: 'owner-a', coverageRequired: true, downloadStates: async () => proof,
    download: jest.fn(async () => { await finish.promise;
      proof = [{ slave_id: dog, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, fixture.now) }]; }) };
  const frames = [];
  let screen, renderer;
  const has = id => renderer.root.findAll(node => node.props.testID === id).length > 0;
  function Probe() {
    screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), owner: 'owner-a', cloud,
      read: fixture.history.readDay, readDays: fixture.history.readDays, clock: () => fixture.now, memoryScope: 'three-screens' });
    return <HistoryScreen screen={screen} top={24} bottomInset={0} name="QA" />;
  }
  const record = () => frames.push(has('history-skeleton') ? (has('history-downloading') ? 'download' : 'skeleton')
    : screen.model ? 'content' : 'blank');
  try {
    act(() => { renderer = Renderer.create(<Probe />); });
    // The very first commit, before any read or timer.
    record();
    await act(async () => { await Promise.resolve(); });
    record();
    expect(cloud.download).toHaveBeenCalledTimes(1);
    record();
    await act(async () => finish.resolve());
    for (let i = 0; i < 5 && !screen.model; i++) { record(); await act(async () => { await Promise.resolve(); }); }
    record();
    expect(screen.model).not.toBeNull();
    const seen = frames.filter((frame, i) => frame !== frames[i - 1]);
    expect(seen[0]).toBe('skeleton');
    expect(seen).not.toContain('blank');
    // Once the line is shown it stays until the content.
    expect(seen.slice(seen.indexOf('download'))).toEqual(['download', 'content']);
  } finally { finish.resolve(); await act(async () => renderer.unmount()); }
});

test('another day starts its list at the top', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const fixture = buildFixture('history-dog');
  let screen, renderer;
  function Probe() {
    screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences), read: fixture.history.readDay,
      readDays: fixture.history.readDays, clock: () => fixture.now, memoryScope: 'scroll-top' });
    return <HistoryScreen screen={screen} top={24} bottomInset={0} name="QA" />;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(screen.model).not.toBeNull();
    scrollTo.mockClear();
    await act(async () => screen.changeDay(screen.day - DAY_MS));
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    scrollTo.mockClear();
    await act(async () => renderer.update(<Probe />));
    expect(scrollTo).not.toHaveBeenCalled();
  } finally { scrollTo.mockRestore(); await act(async () => renderer.unmount()); }
});
