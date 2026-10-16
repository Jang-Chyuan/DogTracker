/* global WeakRef */
// A dog's day seen a moment ago (‹ then ›) shows again at once, without a
// skeleton and without being built again, for the few days kept
// (HistoryDayCache: three, or two long ones), under #174's rules: the same
// view, and for an account's dogs a proof still covering the cutoff it was
// verified at. The days kept are all the memory the screen holds: older days,
// and every day once the screen closes, are let go (audit M6, 2026-10-15).
// A poll that adds rows keeps them by reference, never a copy of the day
// (audit M4). Fictional rows over a real SQLite database (node:sqlite).
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { useHistoryDayRows, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { releaseRecentDogs } from '../src/mapHistory/HistoryRecentDogs';
import { HISTORY_KEPT_DAYS } from '../src/mapHistory/HistoryDayCache';
import { exportView } from '../src/mapHistory/useHistoryExport';
import * as models from '../src/history/screen/HistoryMultiModel';
import * as exact from '../src/mapHistory/HistoryExactSnapshot';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';

const v8 = require('v8');
const vm = require('vm');

const DAY_MS = 86400000;
const TODAY = new Date(2026, 9, 13).getTime();
const NOW = new Date(2026, 9, 13, 20, 30).getTime();
jest.setTimeout(60000);

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['hrtime', 'performance'] }); jest.setSystemTime(NOW); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

// Six days of a dog walking around a fictional place, a fix every 10 s.
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
  connection.sqlite.exec('BEGIN');
  for (let d = 6; d >= 0; d -= 1) {
    const start = TODAY - d * DAY_MS + 6 * 3600000;
    for (let i = 0; i < 900; i += 1) {
      const time = start + i * 10000;
      if (time < NOW - 60000) add(time);
    }
  }
  connection.sqlite.exec('COMMIT');
  const history = createHistoryDatabase(connection);
  await history.load();
  return { connection, history, add };
}

// The account's proof (HistoryCloud), every day complete; `published`: the
// sync's publication ledger.
function fakeCloud() {
  const done = new Map();
  const ledger = { scope: {}, owner: 'a', generation: 1, lineage: 1, latestReadReady: true,
    publishedPending: false, publishedRevision: 0, dataRevision: 0 };
  const cloud = { owner: 'a', coverageRequired: true, publishedReads: true, getPublication: () => ledger,
    downloadStates: jest.fn(async () => [...done.entries()].map(([day, cutoff]) => {
      const bounds = dayBounds(day);
      return { slave_id: 6, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, cutoff) };
    })),
    download: jest.fn(async ({ dayStart, cutoff }) => { done.set(dayKey(new Date(dayStart)), cutoff); }) };
  for (let d = 0; d <= 6; d += 1)
    done.set(dayKey(new Date(TODAY - d * DAY_MS)), d === 0 ? NOW : TODAY - d * DAY_MS + DAY_MS + 3 * 3600000);
  return { cloud, done, ledger };
}

const built = models.multiDayModel;
async function open({ signedIn }) {
  const db = await dogDatabase();
  const { cloud, done } = fakeCloud();
  const counts = { builds: 0 };
  const alive = [];
  jest.spyOn(models, 'multiDayModel').mockImplementation((...args) => {
    counts.builds += 1;
    const model = built(...args);
    alive.push({ day: dayKey(new Date(args[1].dayStart)), ref: new WeakRef(model) });
    return model;
  });
  const frames = [];
  let screen, renderer;
  function Probe({ closed = false }) {
    screen = useHistoryScreen({ target: closed ? null : { subject: 'dog', slaveId: 6 }, read: db.history.historyDayRows,
      readDays: db.history.historyDays, owner: signedIn ? 'a' : null, cloud: signedIn ? cloud : null, clock: Date.now,
      memoryScope: `dog-revisit:${signedIn}:` });
    frames.push({ day: screen.dayKey, model: !!screen.model, loading: screen.loading, download: screen.download?.kind ?? null });
    return null;
  }
  const wait = async ms => { for (let t = 0; t < ms; t += 20) await act(async () => { await jest.advanceTimersByTimeAsync(20); }); };
  await act(async () => { renderer = Renderer.create(<Probe />); });
  await wait(1500);
  const step = async (side, ms = 1500) => {
    frames.length = 0; counts.builds = 0;
    await act(async () => { screen[side](); });
    const day = screen.dayKey;
    const first = screen.model;
    await wait(ms);
    return { day, first, shown: frames.filter(f => f.day === day) };
  };
  const goTo = async (day, ms = 1500) => {
    frames.length = 0; counts.builds = 0;
    await act(async () => { screen.goTo(day); });
    await wait(ms);
    return { day, shown: frames.filter(f => f.day === day) };
  };
  return { db, cloud, done, counts, frames, alive, wait, step, goTo, get screen() { return screen; },
    update: async props => act(async () => renderer.update(<Probe {...props} />)),
    close: async () => { await act(async () => renderer.unmount()); db.connection.close(); } };
}

describe.each([['signed in (a proof per day)', true], ['signed out (this phone\'s rows)', false]])('%s', (_label, signedIn) => {
  test('closed and opened again (card → 看軌跡): a day seen a moment ago is the very model, not built again, nothing downloaded', async () => {
    const s = await open({ signedIn });
    try {
      const a = await s.step('previousDay');
      const modelA = s.screen.model;
      expect(modelA).not.toBeNull();
      await s.update({ closed: true });
      await s.wait(200);
      await s.update({ closed: false });
      await s.wait(1500);
      s.cloud.download.mockClear();
      const again = await s.step('previousDay');
      expect(again.day).toBe(a.day);
      expect(s.screen.model).toBe(modelA);
      expect(s.counts.builds).toBe(0);
      expect(s.cloud.download).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });

  test('‹ ‹ › › : each day seen before shows at once, the very model, built no more', async () => {
    const s = await open({ signedIn });
    try {
      const today = s.screen.model;
      expect(today).not.toBeNull();
      const a = await s.step('previousDay');
      const modelA = s.screen.model;
      const dayA = s.screen.dayModel;
      expect(modelA).not.toBeNull();
      // The first visit: a skeleton, then the day, built once.
      expect(a.shown.some(f => !f.model)).toBe(true);
      expect(s.counts.builds).toBe(1);
      await s.step('previousDay');
      s.cloud.download.mockClear();
      const back = await s.step('nextDay');
      expect(back.day).toBe(a.day);
      // From the tap's own render on: no skeleton, no loading, no download.
      expect(back.first).toBe(modelA);
      expect(back.shown.length).toBeGreaterThan(0);
      expect(back.shown.every(f => f.model && !f.loading && !f.download)).toBe(true);
      expect(s.screen.model).toBe(modelA);
      expect(s.counts.builds).toBe(0);
      // The day kept is the very day model, its whole day (#196: the export
      // when no range was dragged) still there, 00:00 to the day's end.
      expect(s.screen.dayModel).toBe(dayA);
      expect(typeof s.screen.dayModel.wholeDay).toBe('function');
      const whole = exportView({ ...s.screen, manual: false });
      expect(whole.day).not.toBe(dayA);
      expect(whole.range.start).toBe(dayBounds(a.day).dayStart);
      expect(whole.range.end).toBe(dayBounds(a.day).dayEnd - 1);
      expect(s.screen.dayModel.wholeDay()).toBe(whole.day);
      expect(s.cloud.download).not.toHaveBeenCalled();
      // Back to today: shown at once too (its rows are read again and, the
      // clock having moved on, it is built once for now).
      const again = await s.step('nextDay');
      expect(again.first).toBe(today);
      expect(again.shown.every(f => f.model)).toBe(true);
    } finally { await s.close(); }
  });

  test('a day whose rows changed while away shows at once, then is built again with them', async () => {
    const s = await open({ signedIn });
    try {
      const a = await s.step('previousDay');
      const modelA = s.screen.model;
      const points = modelA.points.length;
      await s.step('previousDay');
      // A late fix of that day arrives (an upload, a download).
      s.db.add(dayBounds(a.day).dayStart + 6 * 3600000 + 900 * 10000);
      const back = await s.step('nextDay');
      expect(back.first).toBe(modelA);
      expect(back.shown.every(f => f.model)).toBe(true);
      expect(s.counts.builds).toBe(1);
      expect(s.screen.model).not.toBe(modelA);
      expect(s.screen.model.points.length).toBe(points + 1);
    } finally { await s.close(); }
  });

  test(`only ${HISTORY_KEPT_DAYS} days are kept: a day further back shows its skeleton and is built again`, async () => {
    const s = await open({ signedIn });
    try {
      const first = await s.step('previousDay');
      for (let i = 0; i < HISTORY_KEPT_DAYS; i += 1) await s.step('previousDay');
      const back = await s.goTo(first.day);
      expect(back.shown.some(f => !f.model)).toBe(true);
      expect(s.counts.builds).toBe(1);
    } finally { await s.close(); }
  });

  test('memory: the models of days no longer kept are let go; closing keeps only the days kept, for reopening', async () => {
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc');
    const s = await open({ signedIn });
    const living = () => { jest.clearAllMocks(); gc(); gc(); return s.alive.filter(entry => entry.ref.deref()); };
    try {
      for (let i = 0; i < 5; i += 1) await s.step('previousDay');
      await s.wait(100);
      // Exactly the days kept (the last three seen): not today, not the
      // days before them, not a model a cleanup or timer of an older render
      // still held.
      const kept = living();
      const seen = Array.from({ length: 5 }, (_, i) => dayKey(new Date(TODAY - (i + 1) * DAY_MS)));
      expect(kept.map(entry => entry.day).sort()).toEqual(seen.slice(-HISTORY_KEPT_DAYS).sort());
      await s.update({ closed: true });
      await s.update({ closed: true });
      await s.update({ closed: true });
      await s.wait(100);
      // 2026-10-16: the same days stay for opening the dog again
      // (HistoryRecentDogs), nothing more: no render, cleanup or timer of
      // the closed screen holds a model.
      expect(living().map(entry => entry.day).sort()).toEqual(seen.slice(-HISTORY_KEPT_DAYS).sort());
      releaseRecentDogs();
      // (A WeakRef read keeps its target for the rest of the job.)
      await s.wait(100);
      expect(living()).toEqual([]);
    } finally { await s.close(); }
  });
});

test('signed in: a day whose proof was withdrawn while away is not shown from the days kept', async () => {
  const s = await open({ signedIn: true });
  try {
    const a = await s.step('previousDay');
    await s.step('previousDay');
    s.done.delete(a.day);
    // The proof is read again for the day shown.
    await s.step('previousDay');
    const back = await s.goTo(a.day);
    expect(back.shown.some(f => !f.model)).toBe(true);
    expect(s.cloud.download.mock.calls.map(([request]) => dayKey(new Date(request.dayStart)))).toContain(a.day);
  } finally { await s.close(); }
});

// ---- a poll that adds rows copies nothing --------------------------------

test('today\'s polls keep the rows read by reference: no copy of the day, a new array each time', async () => {
  const day = TODAY;
  const rowsOf = (from, to) => Array.from({ length: to - from }, (_, i) => ({ id: from + i + 1, source: 'local',
    time: day + 6 * 3600000 + (from + i) * 10000, latitude: 24.99, longitude: 121.31, slave_id: 6 }));
  const first = rowsOf(0, 3000);
  const later = [rowsOf(3000, 3010), rowsOf(3010, 3020)];
  let call = 0;
  const read = jest.fn(async () => {
    call += 1;
    if (call === 1) return { rows: first, seed: [], after: { local: { id: 3000 } } };
    const rows = later[call - 2] ?? [];
    return { rows, seed: [], after: { local: { id: 3000 + 10 * (call - 1) } } };
  });
  const copies = jest.spyOn(exact, 'copyHistoryInput');
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 1 };
  const getPublication = () => ledger;
  let state, renderer;
  function Probe() {
    // An account's dog (published reads): the path that copied the day.
    state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'a', clock: () => NOW,
      getPublication, publishedReads: true, publicationRevision: 0 });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    const rows0 = state.rows;
    expect(rows0[0]).toBe(first[0]);
    await act(async () => { await jest.advanceTimersByTimeAsync(15000); });
    const rows1 = state.rows;
    expect(rows1).toHaveLength(3010);
    expect(rows1).not.toBe(rows0);
    expect(rows0).toHaveLength(3000);
    expect(rows1[0]).toBe(first[0]);
    expect(rows1[3009]).toBe(later[0][9]);
    await act(async () => { await jest.advanceTimersByTimeAsync(15000); });
    expect(state.rows).toHaveLength(3020);
    expect(state.version).toBe(3);
    expect(copies.mock.calls.filter(([value]) => Array.isArray(value))).toEqual([]);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
