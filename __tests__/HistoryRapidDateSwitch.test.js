// Rapid ‹ › taps on the history screen (device report, main 629fc74): each
// tap must update the date at once and play its tick, while the day's read,
// proof, download, model build and map presentation run only for the day the
// taps settle on. A single tap keeps its old path: skeleton at once, one read
// and one build. The day rows come from the real HistoryDatabase over a real
// SQLite database (node:sqlite), about 10 000 rows a day, with a small
// simulated native latency per query.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { DAY_STEP_SETTLE_MAX_MS, DAY_STEP_SETTLE_MS, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
import * as models from '../src/history/screen/HistoryMultiModel';
import * as haptics from '../src/utils/haptics';

const DAY_MS = 86400000;
const NOW = new Date(2026, 9, 13, 20, 0).getTime();
const TODAY = new Date(2026, 9, 13).getTime();
// Simulated time a query spends on SQLite's own thread before it answers
// (one query at a time, like the app's single connection).
const QUERY_MS = 12;
const TAP_MS = Number(process.env.RAPID_TAP_MS || 120);
const ROWS_PER_DAY = Number(process.env.RAPID_ROWS || 6000);
const DAYS = 7;
const report = !!process.env.RAPID_REPORT;
const hr = () => Number(process.hrtime.bigint()) / 1e6;
jest.setTimeout(120000);

// Stays of 20 minutes and walks of 12 minutes, one fix every 5 s from 06:00.
function dayFixes(dayStart, count, seed) {
  const out = [];
  let lat = 25.03 + seed * 0.01, lon = 121.56 + seed * 0.01, bearing = seed * 40;
  const every = 5000, stay = 240, walk = 144;
  for (let i = 0; i < count; i += 1) {
    const phase = i % (stay + walk);
    if (phase >= stay) {
      if (phase === stay) bearing += 67;
      lat += Math.cos(bearing * Math.PI / 180) * 0.000055;
      lon += Math.sin(bearing * Math.PI / 180) * 0.000055;
    }
    const jitter = phase < stay ? ((i * 7919) % 11 - 5) * 0.000004 : 0;
    out.push({ time: dayStart + 6 * 3600000 + i * every, latitude: lat + jitter, longitude: lon - jitter,
      accuracy: phase < stay ? 12 : 6, moving: phase >= stay });
  }
  return out;
}

async function database({ subject, queryMs }) {
  const connection = createMemoryConnection();
  const { sqlite } = connection;
  await createDogDatabase(connection).initialize();
  await createCloudDatabase(connection).initialize();
  if (subject === 'phone') {
    sqlite.exec(`CREATE TABLE myLocationTracker (id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL,
      location_at INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy_meters REAL,
      altitude_meters REAL, speed_kmh REAL, heading_degrees REAL, session_id TEXT, motion_state TEXT)`);
    sqlite.exec('CREATE INDEX idx_myLocationTracker_time ON myLocationTracker(recorded_at DESC, id DESC)');
  }
  const insert = subject === 'phone'
    ? sqlite.prepare(`INSERT INTO myLocationTracker (recorded_at, location_at, latitude, longitude, accuracy_meters,
      altitude_meters, speed_kmh, heading_degrees, session_id, motion_state) VALUES (?, ?, ?, ?, ?, 10, ?, 0, 's', ?)`)
    : sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat, slave_lon, satellites, hdop,
      speed_kmh, gps_time) VALUES (?, 7, 6, ?, ?, 9, 0.9, ?, ?)`);
  sqlite.exec('BEGIN');
  for (let d = DAYS - 1; d >= 0; d -= 1) {
    const start = TODAY - d * DAY_MS;
    const count = d === 0 ? Math.min(ROWS_PER_DAY, Math.floor((NOW - start - 6 * 3600000) / 5000)) : ROWS_PER_DAY;
    for (const fix of dayFixes(start, count, d)) {
      if (subject === 'phone') insert.run(fix.time, fix.time - 300, fix.latitude, fix.longitude, fix.accuracy,
        fix.moving ? 4.3 : 0, fix.moving ? 'moving' : 'still');
      else insert.run(fix.time, fix.latitude, fix.longitude, fix.moving ? 4.3 : 0, Math.floor(fix.time / 1000));
    }
  }
  sqlite.exec('COMMIT');
  const stats = { queries: 0, pages: 0, rows: 0, neighbour: 0, days: 0, sqlMs: 0 };
  const run = connection.executeAsync.getMockImplementation();
  // One connection: queries answer one after another, as on the phone.
  let queue = Promise.resolve();
  connection.executeAsync = (query, params) => {
    const turn = queue.then(() => ask(query, params));
    queue = turn.catch(() => {});
    return turn;
  };
  const ask = async (query, params) => {
    stats.queries += 1;
    if (/ORDER BY id LIMIT/.test(query)) stats.pages += 1;
    if (/LIMIT 1$/.test(query.trim())) stats.neighbour += 1;
    if (/SELECT DISTINCT strftime/.test(query)) stats.days += 1;
    if (stats.latency) await new Promise(resolve => setTimeout(resolve, queryMs));
    const began = hr();
    const answer = await run(query, params);
    stats.sqlMs += hr() - began;
    stats.rows += answer.results.length;
    return answer;
  };
  const history = createHistoryDatabase(connection);
  await history.load();
  stats.latency = true;
  return { connection, history, stats };
}

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['hrtime', 'performance'] }); jest.setSystemTime(NOW); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function open({ subject = 'phone', cloud = null, queryMs = QUERY_MS } = {}) {
  const { connection, history, stats } = await database({ subject, queryMs });
  const counts = { builds: 0, buildMs: 0, maps: 0, mapMs: 0, reads: 0, renderMs: 0, ticks: 0 };
  const build = models.multiDayModel, present = models.multiMapPresentation;
  // The clock moves on by the build's own time, as it does on the phone
  // (the screen times its builds with Date.now).
  jest.spyOn(models, 'multiDayModel').mockImplementation((...args) => {
    const began = hr(); counts.builds += 1;
    try { return build(...args); } finally {
      const spent = hr() - began;
      counts.buildMs += spent;
      jest.setSystemTime(Date.now() + Math.round(spent));
    }
  });
  jest.spyOn(models, 'multiMapPresentation').mockImplementation((...args) => {
    const began = hr(); counts.maps += 1;
    try { return present(...args); } finally { counts.mapMs += hr() - began; }
  });
  const haptic = haptics.haptic;
  jest.spyOn(haptics, 'haptic').mockImplementation(kind => { if (kind === 'tick') counts.ticks += 1; return haptic(kind); });
  const read = request => { counts.reads += 1; return history.historyDayRows(request); };
  const target = subject === 'phone' ? { subject: 'phone', slaveId: null } : { subject: 'dog', slaveId: 6 };
  const frames = [];
  let screen, renderer;
  function Probe() {
    screen = useHistoryScreen({ target, read, readDays: history.historyDays, owner: cloud ? 'a' : null, cloud,
      clock: Date.now, memoryScope: `rapid:${subject}:${!!cloud}:`, recording: subject === 'phone' ? true : null });
    frames.push({ day: screen.dayKey, model: screen.model, modelDay: screen.model ? screen.day : null,
      loading: screen.loading, download: screen.download?.kind ?? null, map: screen.map });
    return null;
  }
  const timed = async work => {
    const began = hr();
    await act(work);
    counts.renderMs += hr() - began;
  };
  const reset = () => {
    for (const key of Object.keys(counts)) counts[key] = 0;
    for (const key of Object.keys(stats)) if (key !== 'latency') stats[key] = 0;
    frames.length = 0;
  };
  // Advance fake time in small steps until the day shown has its model.
  const settle = async (limit = 5000) => {
    let waited = 0;
    while (waited < limit && !(screen.model && !screen.loading)) {
      await timed(async () => { await jest.advanceTimersByTimeAsync(10); });
      waited += 10;
    }
    return waited;
  };
  await timed(async () => { renderer = Renderer.create(<Probe />); });
  await settle();
  // Today's first rows also ask for the days again: let that end too.
  await timed(async () => { await jest.advanceTimersByTimeAsync(500); });
  return { counts, stats, frames, reset, settle, timed, get screen() { return screen; },
    close: async () => { await act(async () => renderer.unmount()); connection.close(); } };
}

async function taps(s, count) {
  const visited = [];
  for (let i = 0; i < count; i += 1) {
    if (i) await s.timed(async () => { await jest.advanceTimersByTimeAsync(TAP_MS); });
    await s.timed(async () => { s.screen.previousDay(); });
    visited.push(s.screen.dayKey);
  }
  return visited;
}

const summary = (label, s, extra = {}) => {
  const round = value => Math.round(value);
  const line = { builds: s.counts.builds, maps: s.counts.maps, reads: s.counts.reads, pages: s.stats.pages,
    rowsRead: s.stats.rows, neighbourQueries: s.stats.neighbour, dayListScans: s.stats.days,
    buildMs: round(s.counts.buildMs), sqlMs: round(s.stats.sqlMs), jsMs: round(s.counts.renderMs), ...extra };
  if (report) console.log(`${label} ${JSON.stringify(line)}`);
  return line;
};

test('the fixture is a long day', async () => {
  const s = await open();
  try {
    expect(s.screen.model.points.length).toBeGreaterThan(Math.min(ROWS_PER_DAY, 5000) * 0.5);
  } finally { await s.close(); }
});

test('five rapid ‹ taps: the date moves on every tap, only the final day is read to the end and built', async () => {
  const s = await open();
  try {
    s.reset();
    const visited = await taps(s, 5);
    const expected = Array.from({ length: 5 }, (_, i) => dayKey(new Date(TODAY - (i + 1) * DAY_MS)));
    // The label and the tick follow every tap at once.
    expect(visited).toEqual(expected);
    expect(s.counts.ticks).toBe(5);
    const waited = await s.settle();
    const line = summary('rapid', s, { settleAfterLastTapMs: waited });
    expect(s.screen.dayKey).toBe(expected[4]);
    expect(s.screen.model.points.length).toBeGreaterThan(0);
    // One build and one map presentation: the final day's.
    expect(line.builds).toBe(1);
    expect(line.maps).toBe(1);
    // No intermediate day ever reached the screen.
    const shown = new Set(s.frames.filter(frame => frame.model).map(frame => dayKey(new Date(frame.modelDay))));
    expect([...shown]).toEqual([expected[4]]);
    expect(s.frames.filter(frame => frame.map).every(frame => frame.day === expected[4])).toBe(true);
    // The local day list is not scanned again for a past day.
    expect(line.dayListScans).toBe(0);
  } finally { await s.close(); }
});

test('a day read the taps moved on from stops at its next page', async () => {
  // A slower database: each day's read is still running when the next tap comes.
  const s = await open({ queryMs: 40 });
  try {
    s.reset();
    const visited = await taps(s, 5);
    await s.settle();
    const line = summary('slow-read', s);
    expect(s.screen.dayKey).toBe(visited[4]);
    expect(line.builds).toBe(1);
    // The final day's own pages, and for each superseded day only what was
    // asked before the next tap (not every superseded day to its end).
    const dayPages = Math.ceil(ROWS_PER_DAY / 2000) + (ROWS_PER_DAY % 2000 ? 0 : 1);
    expect(line.pages).toBeLessThanOrEqual(dayPages + 4 * Math.ceil(TAP_MS / 40));
    expect(line.pages).toBeLessThan(5 * dayPages);
  } finally { await s.close(); }
});

test('a single ‹ tap: skeleton at once, one read and one build, the day shortly after', async () => {
  const s = await open();
  try {
    s.reset();
    await s.timed(async () => { s.screen.previousDay(); });
    expect(s.screen.model).toBeNull();
    expect(s.screen.loading).toBe(true);
    const waited = await s.settle();
    const line = summary('single', s, { settleAfterTapMs: waited });
    expect(s.screen.dayKey).toBe(dayKey(new Date(TODAY - DAY_MS)));
    expect(line.builds).toBe(1);
    expect(line.maps).toBe(1);
    expect(line.reads).toBe(1);
    expect(s.counts.ticks).toBe(1);
    // Every frame between the tap and the day is the skeleton.
    const before = s.frames.slice(0, s.frames.findIndex(frame => frame.model));
    expect(before.every(frame => frame.loading && !frame.map)).toBe(true);
  } finally { await s.close(); }
});

test('a single ‹ tap waits at most the settle time more than its read; a calendar choice does not wait', async () => {
  const s = await open({ queryMs: 1 });
  try {
    s.reset();
    await s.timed(async () => { s.screen.previousDay(); });
    const stepped = await s.settle();
    expect(stepped).toBeGreaterThanOrEqual(DAY_STEP_SETTLE_MS);
    expect(stepped).toBeLessThanOrEqual(DAY_STEP_SETTLE_MAX_MS + 20);
    s.reset();
    await s.timed(async () => { s.screen.goTo(dayKey(new Date(TODAY - 3 * DAY_MS))); });
    expect(s.screen.model).toBeNull();
    const chosen = await s.settle();
    expect(chosen).toBeLessThan(DAY_STEP_SETTLE_MS);
    expect(s.counts.builds).toBe(1);
  } finally { await s.close(); }
});

test('taps handled in one batch (queued behind other work) each step one more day', async () => {
  const s = await open();
  try {
    s.reset();
    // One render's callbacks, three taps before the next render.
    await s.timed(async () => { const { previousDay } = s.screen; previousDay(); previousDay(); previousDay(); });
    expect(s.screen.dayKey).toBe(dayKey(new Date(TODAY - 3 * DAY_MS)));
    expect(s.counts.ticks).toBe(3);
    await s.timed(async () => { const { nextDay } = s.screen; nextDay(); nextDay(); });
    expect(s.screen.dayKey).toBe(dayKey(new Date(TODAY - DAY_MS)));
    await s.settle();
    expect(s.counts.builds).toBe(1);
    expect(s.frames.filter(frame => frame.model).every(frame => frame.day === dayKey(new Date(TODAY - DAY_MS)))).toBe(true);
  } finally { await s.close(); }
});

test('‹ then › back within the settle time: the day shown again, built once, nothing else shown', async () => {
  const s = await open();
  try {
    await s.timed(async () => { s.screen.previousDay(); });
    await s.settle();
    const day = s.screen.dayKey;
    s.reset();
    await taps(s, 1);
    await s.timed(async () => { await jest.advanceTimersByTimeAsync(TAP_MS); });
    await s.timed(async () => { s.screen.nextDay(); });
    expect(s.screen.dayKey).toBe(day);
    expect(s.screen.model).toBeNull();
    await s.settle();
    expect(s.screen.dayKey).toBe(day);
    expect(s.counts.builds).toBe(1);
    expect(s.counts.ticks).toBe(2);
    expect(s.frames.filter(frame => frame.model).every(frame => frame.day === day)).toBe(true);
  } finally { await s.close(); }
});

test('rapid ‹ taps over days the proof leaves incomplete start one download, for the final day', async () => {
  const done = new Map();
  const cloud = { owner: 'a', coverageRequired: true,
    downloadStates: jest.fn(async () => [...done.entries()].map(([day, cutoff]) => {
      const bounds = dayBounds(day);
      return { slave_id: 6, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, cutoff) };
    })),
    download: jest.fn(({ dayStart, cutoff, signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { done.set(dayKey(new Date(dayStart)), cutoff); resolve(); }, 400);
      signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(new Error('aborted')); });
    })) };
  // Today is proven so the screen opens on its content.
  done.set(dayKey(new Date(TODAY)), NOW);
  const s = await open({ subject: 'dog', cloud });
  try {
    expect(s.screen.model).not.toBeNull();
    s.reset(); cloud.download.mockClear();
    const visited = await taps(s, 5);
    // Each day shows 「下載 … 的紀錄」 at once (#141), but nothing is fetched
    // for a day the taps pass through.
    const passed = s.frames.filter(frame => visited.includes(frame.day));
    expect(passed.length).toBeGreaterThan(0);
    expect(passed.every(frame => frame.download === 'downloading' && !frame.model)).toBe(true);
    expect(cloud.download).not.toHaveBeenCalled();
    const waited = await s.settle();
    const line = summary('download', s, { downloads: cloud.download.mock.calls.length, settleAfterLastTapMs: waited });
    expect(s.screen.dayKey).toBe(visited[4]);
    expect(cloud.download).toHaveBeenCalledTimes(1);
    expect(dayKey(new Date(cloud.download.mock.calls[0][0].dayStart))).toBe(visited[4]);
    expect(line.builds).toBe(1);
  } finally { await s.close(); }
});
