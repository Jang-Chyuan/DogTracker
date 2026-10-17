// Today's history of a dog opened again within HISTORY_TODAY_REUSE_MS
// (2026-10-17, user): the view seen a moment ago shows at once, with
// 「更新中」 on its summary line and no 「下載 … 的紀錄」 or skeleton, while
// today's newest rows are fetched; then the fresh day replaces it in place.
// An older view, or one whose stored proof was withdrawn (#174), waits for
// the download as before. Fictional rows over a real SQLite database.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import HistoryRangeSummary from '../src/mapHistory/HistoryRangeSummary';
import { HISTORY_TODAY_REUSE_MS, releaseRecentDogs } from '../src/mapHistory/HistoryRecentDogs';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';

const DAY_MS = 86400000;
const TODAY = new Date(2026, 9, 13).getTime();
const NOW = new Date(2026, 9, 13, 20, 30).getTime();
const TODAY_KEY = dayKey(new Date(TODAY));
jest.setTimeout(60000);

beforeEach(() => { releaseRecentDogs(); jest.useFakeTimers({ doNotFake: ['hrtime', 'performance'] }); jest.setSystemTime(NOW); });
afterEach(() => { releaseRecentDogs(); jest.restoreAllMocks(); jest.useRealTimers(); });

async function dogDatabase() {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  await createCloudDatabase(connection).initialize();
  const insert = connection.sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat,
    slave_lon, satellites, hdop, speed_kmh, gps_time) VALUES (?, 7, 6, ?, ?, 9, 0.9, 4, ?)`);
  const add = time => {
    const i = Math.floor((time % DAY_MS) / 10000);
    insert.run(time, 24.99 + (i % 600) * 0.00003, 121.31 + Math.floor(i / 600) * 0.0004, Math.floor(time / 1000));
  };
  for (let time = TODAY + 6 * 3600000; time < NOW - 60000; time += 60000) add(time);
  const history = createHistoryDatabase(connection);
  await history.load();
  return { connection, history, add };
}

// The account's proof, today complete up to NOW. `download` waits for `release()`.
function fakeCloud() {
  const done = new Map([[TODAY_KEY, NOW]]);
  const ledger = { scope: {}, owner: 'a', generation: 1, lineage: 1, latestReadReady: true,
    publishedPending: false, publishedRevision: 0, dataRevision: 0 };
  let release = null;
  const cloud = { owner: 'a', coverageRequired: true, publishedReads: true, getPublication: () => ledger,
    downloadStates: jest.fn(async () => [...done.entries()].map(([day, cutoff]) => {
      const bounds = dayBounds(day);
      return { slave_id: 6, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, cutoff) };
    })),
    download: jest.fn(({ dayStart, cutoff }) => new Promise(resolve => {
      release = () => { done.set(dayKey(new Date(dayStart)), cutoff); resolve(); };
    })) };
  return { cloud, done, ledger, release: () => release?.() };
}

async function open() {
  const db = await dogDatabase();
  const fake = fakeCloud();
  const frames = [];
  let screen, renderer;
  function Probe({ closed = false }) {
    screen = useHistoryScreen({ target: closed ? null : { subject: 'dog', slaveId: 6 }, read: db.history.historyDayRows,
      readDays: db.history.historyDays, owner: 'a', cloud: fake.cloud, clock: Date.now, memoryScope: 'today-reopen:' });
    if (!closed) frames.push({ model: screen.model, updating: !!screen.updating, download: screen.download?.kind ?? null });
    return null;
  }
  const wait = async ms => { for (let t = 0; t < ms; t += 20) await act(async () => { await jest.advanceTimersByTimeAsync(20); }); };
  await act(async () => { renderer = Renderer.create(<Probe />); });
  await wait(1500);
  const reopen = async ({ after }) => {
    await act(async () => renderer.update(<Probe closed />));
    await wait(200);
    jest.setSystemTime(Date.now() + after);
    frames.length = 0;
    await act(async () => renderer.update(<Probe />));
  };
  return { ...fake, db, frames, wait, reopen, get screen() { return screen; },
    close: async () => { await act(async () => renderer.unmount()); db.connection.close(); } };
}

test(`within ${HISTORY_TODAY_REUSE_MS / 60000} minutes: today's view at once with 更新中, then the fresh day in place`, async () => {
  const s = await open();
  try {
    const seen = s.screen.model;
    expect(seen).not.toBeNull();
    expect(s.screen.updating).toBe(false);
    const points = seen.points.length;
    // A fix of today arrives while the screen is closed.
    s.db.add(NOW + 60000);
    await s.reopen({ after: 2 * 60000 });
    await s.wait(300);
    // Shown from the proof's read on, never a skeleton or 「下載 … 的紀錄」.
    expect(s.frames.filter(frame => frame.model).length).toBeGreaterThan(0);
    const firstShown = s.frames.findIndex(frame => frame.model);
    expect(s.frames.slice(firstShown).every(frame => frame.model === seen && frame.updating && !frame.download)).toBe(true);
    expect(s.cloud.download).toHaveBeenCalled();
    // The summary line says 更新中 (the catch-up pill's shimmer).
    const summary = updating => <HistoryRangeSummary model={s.screen.model} subject="dog"
      range={s.screen.range} track={s.screen.track} today updating={updating} />;
    let tree;
    await act(async () => { tree = Renderer.create(summary(s.screen.updating)); });
    const label = tree.root.findAll(node => node.props.testID === 'history-summary-updating');
    expect(label.length).toBeGreaterThan(0);
    expect(tree.root.findAll(node => node.props.children === '更新中').length).toBeGreaterThan(0);
    await act(async () => tree.update(summary(false)));
    expect(tree.root.findAll(node => node.props.testID === 'history-summary-updating')).toHaveLength(0);
    await act(async () => tree.unmount());
    // Today's tail is in: the fresh day replaces it, 更新中 goes.
    await act(async () => s.release());
    await s.wait(1500);
    expect(s.screen.model).not.toBe(seen);
    expect(s.screen.model.points.length).toBe(points + 1);
    expect(s.screen.updating).toBe(false);
    expect(s.frames.every(frame => frame.model || frame === s.frames[0] || !frame.download)).toBe(true);
  } finally { await s.close(); }
});

test(`after ${HISTORY_TODAY_REUSE_MS / 60000} minutes: the skeleton and the download, as before`, async () => {
  const s = await open();
  try {
    expect(s.screen.model).not.toBeNull();
    await s.reopen({ after: HISTORY_TODAY_REUSE_MS + 60000 });
    await s.wait(300);
    expect(s.frames.every(frame => !frame.model && !frame.updating)).toBe(true);
    expect(s.screen.download?.kind).toBe('downloading');
    await act(async () => s.release());
    await s.wait(1500);
    expect(s.screen.model).not.toBeNull();
    expect(s.screen.updating).toBe(false);
  } finally { await s.close(); }
});

test('a withdrawn proof hides the kept view: the skeleton until the day is downloaded again (#174)', async () => {
  const s = await open();
  try {
    expect(s.screen.model).not.toBeNull();
    s.done.delete(TODAY_KEY);
    await s.reopen({ after: 60000 });
    await s.wait(300);
    // Hidden as soon as the proof read again says so (until then the last
    // read is what holds, as within one opening), never shown after it.
    expect(s.cloud.downloadStates).toHaveBeenCalled();
    const hidden = s.frames.findIndex(frame => !frame.model);
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(s.frames.slice(hidden).every(frame => !frame.model && !frame.updating)).toBe(true);
    expect(s.screen.download?.kind).toBe('downloading');
    await act(async () => s.release());
    await s.wait(1500);
    expect(s.screen.model).not.toBeNull();
  } finally { await s.close(); }
});

test('another account (or lineage) never sees the kept view', async () => {
  const s = await open();
  try {
    expect(s.screen.model).not.toBeNull();
    s.ledger.lineage = 2;
    s.ledger.generation = 2;
    await s.reopen({ after: 60000 });
    await s.wait(300);
    expect(s.frames.every(frame => !frame.model)).toBe(true);
  } finally { await s.close(); }
});
