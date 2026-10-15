// 我的路線 opened again, or shown again after the app was away (device
// report 2026-10-15: the first open after ten minutes in the background took
// over 10 s; opening it again was quick). The day's rows stay with the
// screen's reader: coming back reads only the fixes recorded since, proves
// the rest unchanged with one count, and an unchanged day is not built
// again. The rows come from the real HistoryDatabase over a real SQLite
// database (node:sqlite) holding a long day of invented fixes.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { KEPT_ROWS_WAIT_MS, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import * as models from '../src/history/screen/HistoryMultiModel';

const DAY_MS = 86400000;
const TODAY = new Date(2026, 9, 13).getTime();
const NOW = new Date(2026, 9, 13, 18, 0).getTime();
const EVERY_MS = 5000;
const FIRST_FIX = TODAY + 6 * 3600000;
jest.setTimeout(60000);

// Stays of 20 minutes and walks of 12 minutes, one fix every 5 s.
function fix(i, dayStart = TODAY) {
  const stay = 240, walk = 144, phase = i % (stay + walk), loop = Math.floor(i / (stay + walk));
  const moving = phase >= stay;
  const step = moving ? phase - stay : 0;
  const lat = 24.99 + loop * 0.004 + step * 0.000028, lon = 121.31 + loop * 0.003 + step * 0.00002;
  return { time: dayStart + 6 * 3600000 + i * EVERY_MS, latitude: lat, longitude: lon, accuracy: moving ? 6 : 12, moving };
}

async function database() {
  const connection = createMemoryConnection();
  const { sqlite } = connection;
  sqlite.exec(`CREATE TABLE myLocationTracker (id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL,
    location_at INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy_meters REAL,
    altitude_meters REAL, speed_kmh REAL, heading_degrees REAL, session_id TEXT, motion_state TEXT)`);
  sqlite.exec('CREATE INDEX idx_myLocationTracker_time ON myLocationTracker(recorded_at DESC, id DESC)');
  const insert = sqlite.prepare(`INSERT INTO myLocationTracker (recorded_at, location_at, latitude, longitude,
    accuracy_meters, altitude_meters, speed_kmh, heading_degrees, session_id, motion_state)
    VALUES (?, ?, ?, ?, ?, 10, ?, 0, 's', ?)`);
  const add = (from, to, dayStart = TODAY) => {
    sqlite.exec('BEGIN');
    for (let i = from; i < to; i += 1) {
      const f = fix(i, dayStart);
      insert.run(f.time, f.time - 300, f.latitude, f.longitude, f.accuracy, f.moving ? 4.3 : 0, f.moving ? 'moving' : 'still');
    }
    sqlite.exec('COMMIT');
  };
  // Two earlier days, then today until shortly before now.
  add(0, 3000, TODAY - 2 * DAY_MS);
  add(0, 3000, TODAY - DAY_MS);
  const stats = { queries: 0, pages: 0, rows: 0, pageRows: 0, dayScans: 0, counts: 0 };
  const run = connection.executeAsync.getMockImplementation();
  connection.executeAsync = async (query, params) => {
    stats.queries += 1;
    if (/ORDER BY id LIMIT/.test(query)) stats.pages += 1;
    if (/SELECT DISTINCT strftime/.test(query)) stats.dayScans += 1;
    if (/SELECT COUNT\(\*\) AS n FROM myLocationTracker/.test(query)) stats.counts += 1;
    const answer = await run(query, params);
    stats.rows += answer.results.length;
    if (/ORDER BY id LIMIT/.test(query)) stats.pageRows += answer.results.length;
    return answer;
  };
  return { connection, sqlite, add, stats, history: createHistoryDatabase(connection) };
}

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['hrtime', 'performance'] }); jest.setSystemTime(NOW); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

const TODAY_ROWS = Math.floor((NOW - 60000 - FIRST_FIX) / EVERY_MS);

const build = models.multiDayModel;
async function screenOf(db, { readDelayMs = 0 } = {}) {
  const counts = { builds: 0, reads: 0, verified: 0 };
  const frames = [];
  jest.spyOn(models, 'multiDayModel').mockImplementation((...args) => { counts.builds += 1; return build(...args); });
  const read = request => {
    counts.reads += 1;
    if (request.verify) counts.verified += 1;
    if (readDelayMs && request.verify)
      return new Promise(resolve => setTimeout(resolve, readDelayMs)).then(() => db.history.historyDayRows(request));
    return db.history.historyDayRows(request);
  };
  const phone = { subject: 'phone', slaveId: null };
  let screen, renderer;
  function Probe({ open, active }) {
    screen = useHistoryScreen({ target: open ? phone : null, read, readDays: db.history.historyDays,
      clock: Date.now, active: open && active, memoryScope: 'reopen:', recording: true });
    frames.push(screen.model);
    return null;
  }
  const show = async ({ open = true, active = true } = {}) => {
    await act(async () => {
      if (renderer) renderer.update(<Probe open={open} active={active} />);
      else renderer = Renderer.create(<Probe open={open} active={active} />);
    });
  };
  const settle = async (ms = 600) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
  const reset = () => {
    for (const key of Object.keys(counts)) counts[key] = 0;
    frames.length = 0;
    for (const key of Object.keys(db.stats)) db.stats[key] = 0;
  };
  return { counts, frames, show, settle, reset, get screen() { return screen; },
    unmount: async () => { await act(async () => renderer.unmount()); } };
}

const summary = model => ({ points: model.points.length, nodes: model.nodes.map(n => `${n.type}:${n.start}:${n.end}`) });

test('opened again after more fixes: only the new fixes are read, the day is built once, with them', async () => {
  const db = await database();
  db.add(0, TODAY_ROWS - 120);
  const s = await screenOf(db);
  try {
    await s.show();
    await s.settle();
    expect(s.screen.model.points.length).toBeGreaterThan(1000);
    const firstOpen = { pages: db.stats.pages, rows: db.stats.rows };
    expect(firstOpen.pages).toBeGreaterThan(1);
    // Closed for ten minutes; the recorder adds 120 fixes meanwhile.
    await s.show({ open: false });
    jest.setSystemTime(NOW);
    db.add(TODAY_ROWS - 120, TODAY_ROWS);
    s.reset();
    await s.show();
    await s.settle();
    // One read: the count proving the kept rows, then the 120 new ones.
    expect(s.counts.reads).toBe(1);
    expect(s.counts.verified).toBe(1);
    expect(db.stats.counts).toBe(1);
    expect(db.stats.pages).toBe(1);
    expect(db.stats.pageRows).toBe(120);
    // The day list jumps along the time index instead of scanning every row.
    expect(db.stats.dayScans).toBe(0);
    // Built once, when the new fixes are in (not once without them first).
    expect(s.counts.builds).toBe(1);
    const reopened = summary(s.screen.model);
    // The same day as a reader that read it all from the start.
    const fresh = await screenOf(db);
    await s.unmount();
    try {
      await fresh.show();
      await fresh.settle();
      expect(summary(fresh.screen.model)).toEqual(reopened);
    } finally { await fresh.unmount(); }
  } finally { db.connection.close(); }
});

test('back from the background with no new fixes: nothing is read again, the day is built once for the time now', async () => {
  const db = await database();
  db.add(0, TODAY_ROWS);
  const s = await screenOf(db);
  try {
    await s.show();
    await s.settle();
    const shown = summary(s.screen.model);
    s.reset();
    await s.show({ active: false });
    // Nothing is built for a screen in the background.
    expect(s.counts.builds).toBe(0);
    jest.setSystemTime(NOW + 10 * 60000);
    await s.show({ active: true });
    await s.settle();
    // The view shown before stays while its rows are read on.
    expect(s.frames.every(Boolean)).toBe(true);
    expect(s.counts.reads).toBe(1);
    expect(db.stats.pages).toBe(1);
    expect(db.stats.pageRows).toBe(0);
    expect(s.counts.builds).toBe(1);
    expect(summary(s.screen.model).points).toBe(shown.points);
  } finally { await s.unmount(); db.connection.close(); }
});

test('rows removed while it was closed (刪除我的路線): the day is read again from the start', async () => {
  const db = await database();
  db.add(0, TODAY_ROWS);
  const s = await screenOf(db);
  try {
    await s.show();
    await s.settle();
    expect(s.screen.model.points.length).toBeGreaterThan(1000);
    await s.show({ open: false });
    db.sqlite.exec(`DELETE FROM myLocationTracker WHERE recorded_at >= ${TODAY}`);
    db.add(TODAY_ROWS - 30, TODAY_ROWS);
    s.reset();
    await s.show();
    await s.settle();
    expect(s.counts.verified).toBe(1);
    expect(s.screen.model.points.length).toBeLessThanOrEqual(30);
  } finally { await s.unmount(); db.connection.close(); }
});

test('historyDays for my route: the same days as a scan of every row', async () => {
  const db = await database();
  try {
    db.add(0, 400);
    // A fix a moment before and after local midnight, and a lone day.
    const insert = db.sqlite.prepare(`INSERT INTO myLocationTracker (recorded_at, location_at, latitude, longitude)
      VALUES (?, ?, 24.99, 121.31)`);
    for (const time of [TODAY + DAY_MS - 1, TODAY + DAY_MS, TODAY - 10 * DAY_MS + 3600000])
      insert.run(time, time);
    const scan = db.sqlite.prepare(`SELECT DISTINCT strftime('%Y-%m-%d', recorded_at / 1000, 'unixepoch', 'localtime') AS day
      FROM myLocationTracker`).all().map(row => row.day).sort();
    db.stats.dayScans = 0;
    expect(await db.history.historyDays({ subject: 'phone' })).toEqual(scan);
    expect(scan).toHaveLength(5);
    expect(db.stats.dayScans).toBe(0);
  } finally { db.connection.close(); }
});

test('a slow read of the new fixes: the kept rows are shown after the wait, the new ones follow', async () => {
  const db = await database();
  db.add(0, TODAY_ROWS - 60);
  const s = await screenOf(db, { readDelayMs: 3000 });
  try {
    await s.show();
    await s.settle();
    await s.show({ open: false });
    db.add(TODAY_ROWS - 60, TODAY_ROWS);
    s.reset();
    await s.show();
    await s.settle(KEPT_ROWS_WAIT_MS - 50);
    expect(s.screen.model).toBeNull();
    await s.settle(100);
    expect(s.counts.builds).toBe(1);
    const kept = s.screen.model.points.length;
    await s.settle(3000);
    expect(s.counts.builds).toBe(2);
    expect(s.screen.model.points.length).toBeGreaterThan(kept);
  } finally { await s.unmount(); db.connection.close(); }
});
