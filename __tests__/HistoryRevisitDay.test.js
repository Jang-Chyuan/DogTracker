// Coming back to a day already downloaded on this opening (device 0.3.222,
// 2026-10-15 01:30: ‹ to 10/14 downloaded it, ‹ to 10/13 downloaded that, ›
// back to 10/14 showed 「下載 10/14 的紀錄…」 and downloaded it again). A day
// still taking rows (today, or yesterday before its two hours of late uploads
// are over) needed its proof up to the moment it was opened again. And a
// download cancelled part way kept nothing: the next one started over.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { createHistoryCloud, DOWNLOAD_BEFORE_MS, TAIL_OVERLAP_MS } from '../src/mapHistory/HistoryCloud';
import { historyCoverage } from '../src/cloud/HistoryCoverage';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';

const DAY_MS = 86400000;
const TODAY = new Date(2026, 9, 13).getTime();
jest.setTimeout(60000);

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['hrtime', 'performance'] }); });
afterEach(() => { jest.useRealTimers(); });

// A few days of a dog walking, one fix every 10 s from 06:00 (fictional place).
async function dogDatabase(now) {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  await createCloudDatabase(connection).initialize();
  const insert = connection.sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat,
    slave_lon, satellites, hdop, speed_kmh, gps_time) VALUES (?, 7, 6, ?, ?, 9, 0.9, 4, ?)`);
  connection.sqlite.exec('BEGIN');
  for (let d = 4; d >= 0; d -= 1) {
    const start = TODAY - d * DAY_MS + 6 * 3600000;
    for (let i = 0; i < 800; i += 1) {
      const time = start + i * 10000;
      if (time >= now) break;
      insert.run(time, 10 + i * 0.00005, 20 + d * 0.01, Math.floor(time / 1000));
    }
  }
  connection.sqlite.exec('COMMIT');
  const history = createHistoryDatabase(connection);
  await history.load();
  return { connection, history };
}

// The cloud's proof as HistoryCloud keeps it: a day is complete up to the
// cutoff its download was made for. `published`: like the app's sync, each
// download publishes (the publication revision moves at its start and end).
function fakeCloud(now, { published = false, downloadMs = 400 } = {}) {
  const done = new Map();
  const ledger = { scope: {}, owner: 'a', generation: 1, lineage: 1, latestReadReady: true,
    publishedPending: false, publishedRevision: 0, dataRevision: 0 };
  const listeners = new Set();
  const publish = () => {
    if (!published) return;
    ledger.publishedRevision += 2; ledger.dataRevision += 1;
    listeners.forEach(listener => listener());
  };
  const cloud = { owner: 'a', coverageRequired: true,
    ...(published ? { publishedReads: true, getPublication: () => ledger } : {}),
    downloadStates: jest.fn(async () => [...done.entries()].map(([day, cutoff]) => {
      const bounds = dayBounds(day);
      return { slave_id: 6, day, complete: 1, ...historyCoverage(bounds.dayStart, bounds.dayEnd, cutoff) };
    })),
    download: jest.fn(({ dayStart, cutoff, signal }) => new Promise((resolve, reject) => {
      const day = dayKey(new Date(dayStart));
      // Marked incomplete first (a whole window), as HistoryCloud does.
      done.delete(day); publish();
      const timer = setTimeout(() => { done.set(day, cutoff); publish(); resolve(); }, downloadMs);
      signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(new Error('aborted')); });
    })) };
  done.set(dayKey(new Date(TODAY)), now);
  return { cloud, done, ledger, listeners };
}
const downloaded = cloud => cloud.download.mock.calls.map(([request]) => dayKey(new Date(request.dayStart)));

async function open(now, options) {
  jest.setSystemTime(now);
  const { connection, history } = await dogDatabase(now);
  const { cloud, done, ledger, listeners } = fakeCloud(now, options);
  const frames = [];
  let screen, renderer;
  function Probe() {
    const [, published] = React.useState(0);
    React.useEffect(() => {
      const listener = () => published(value => value + 1);
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []);
    screen = useHistoryScreen({ target: { subject: 'dog', slaveId: 6 }, read: history.historyDayRows,
      readDays: history.historyDays, owner: 'a', cloud, clock: Date.now, memoryScope: `revisit:${now}:`,
      publicationRevision: ledger.publishedRevision });
    frames.push({ day: screen.dayKey, download: screen.download?.kind ?? null });
    return null;
  }
  // In steps: each act() commits what the timers before it started.
  const wait = async ms => { for (let t = 0; t < ms; t += 20) await act(async () => { await jest.advanceTimersByTimeAsync(20); }); };
  await act(async () => { renderer = Renderer.create(<Probe />); });
  await wait(1500);
  return { cloud, done, frames, wait, get screen() { return screen; },
    tap: async side => act(async () => { s().screen[side](); }),
    close: async () => { await act(async () => renderer.unmount()); connection.close(); } };
  function s() { return { screen }; }
}

test.each([
  ['01:30, yesterday still taking late uploads', 1],
  ['20:30, a closed day', 20],
])('‹ ‹ › at %s: the day just downloaded is shown again without 「下載」 or a second download', async (_label, hour) => {
  const s = await open(new Date(2026, 9, 13, hour, 30).getTime());
  try {
    s.cloud.download.mockClear();
    await s.tap('previousDay');
    const a = s.screen.dayKey;
    await s.wait(1500);
    await s.tap('previousDay');
    const b = s.screen.dayKey;
    await s.wait(1500);
    expect(downloaded(s.cloud)).toEqual([a, b]);
    s.frames.length = 0;
    await s.tap('nextDay');
    expect(s.screen.dayKey).toBe(a);
    await s.wait(1500);
    expect(downloaded(s.cloud)).toEqual([a, b]);
    expect(s.frames.filter(frame => frame.day === a).map(frame => frame.download).filter(Boolean)).toEqual([]);
    expect(s.screen.model).not.toBeNull();
  } finally { await s.close(); }
});

test.each([
  ['after the other day finished', 2500],
  ['while the other day is still downloading', 600],
])('with the sync publishing each download: ‹ ‹ › %s', async (_label, away) => {
  const s = await open(new Date(2026, 9, 13, 1, 30).getTime(), { published: true, downloadMs: 1500 });
  try {
    s.cloud.download.mockClear();
    await s.tap('previousDay');
    const a = s.screen.dayKey;
    await s.wait(2500);
    expect(s.screen.model).not.toBeNull();
    await s.tap('previousDay');
    await s.wait(away);
    s.frames.length = 0;
    await s.tap('nextDay');
    expect(s.screen.dayKey).toBe(a);
    await s.wait(2500);
    expect(downloaded(s.cloud).filter(day => day === a)).toHaveLength(1);
    expect(s.frames.filter(frame => frame.day === a).map(frame => frame.download).filter(Boolean)).toEqual([]);
    expect(s.screen.model).not.toBeNull();
  } finally { await s.close(); }
});

test('back to today after ‹: today is shown again without downloading it', async () => {
  const s = await open(new Date(2026, 9, 13, 20, 30).getTime());
  try {
    const today = s.screen.dayKey;
    expect(s.screen.model).not.toBeNull();
    s.cloud.download.mockClear();
    await s.tap('previousDay');
    await s.wait(1500);
    s.frames.length = 0;
    await s.tap('nextDay');
    expect(s.screen.dayKey).toBe(today);
    await s.wait(1500);
    expect(downloaded(s.cloud)).not.toContain(today);
    expect(s.frames.map(frame => frame.download).filter(Boolean)).toEqual([]);
    expect(s.screen.model).not.toBeNull();
  } finally { await s.close(); }
});

test('a day whose proof was withdrawn while away is downloaded again', async () => {
  const s = await open(new Date(2026, 9, 13, 20, 30).getTime());
  try {
    s.cloud.download.mockClear();
    await s.tap('previousDay');
    const a = s.screen.dayKey;
    await s.wait(1500);
    await s.tap('previousDay');
    // Evicted while the other day downloads: its proof is read again after.
    s.done.delete(a);
    await s.wait(1500);
    await s.tap('nextDay');
    expect(s.screen.dayKey).toBe(a);
    await s.wait(1500);
    expect(downloaded(s.cloud).filter(day => day === a)).toHaveLength(2);
  } finally { await s.close(); }
});

// ---- a cancelled download keeps what it saved --------------------------------

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const telemetry = (n, time) => ({ event_id: uuid(n), master_id: 7, slave_id: 6, seq: n, received_at: new Date(time).toISOString(),
  payload: { lat: 10000000, lon: 20000000, satellites: 9 }, rssi: -70, snr: 5, upload_source: 'master', phone_received_at: null });

// Supabase's query builder: `answer(log, signal)` answers each query.
function client(answer) {
  const calls = [];
  return { calls, from: table => {
    const log = [['from', table]]; calls.push(log);
    const q = {};
    for (const name of ['select', 'eq', 'in', 'gte', 'lt', 'gt', 'or', 'order', 'limit']) q[name] = (...args) => { log.push([name, ...args]); return q; };
    q.abortSignal = signal => answer(log, signal);
    return q;
  } };
}
const hang = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
const startOf = log => Date.parse(log.find(([name, column]) => name === 'gte' && column === 'received_at')[2]);

function store(states = []) {
  const kept = [];
  return { kept, database: { initialize: async () => {}, beginManualScope: jest.fn(async () => {}),
    savePage: jest.fn(async (owner, records) => { kept.push(...records); }),
    historyDownloadStates: jest.fn(async () => states),
    setHistoryDownloadState: jest.fn(async () => {}),
    publishManualScope: jest.fn(async () => ({ dataRevision: 1 })) } };
}
// Like the sync's runManual: the work's lease ends with its abort.
const runManual = (work, abort) => work(() => !abort.signal.aborted, commit => commit());

test('a download cancelled part way publishes the pages it saved as a completed prefix', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const last = dayStart + 9 * 3600000;
  const c = client((log, signal) => (log.some(([name]) => name === 'or') ? hang(signal)
    : Promise.resolve({ data: [telemetry(1, dayStart + 8 * 3600000), telemetry(2, last)], error: null })));
  const { database } = store();
  const cloud = createHistoryCloud({ client: c, database, owner: 'a', runManual });
  const controller = new AbortController();
  const ends = [];
  const running = cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 5 * 3600000, signal: controller.signal,
    onDogEnd: (id, status) => ends.push(status) });
  while (c.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await expect(running).rejects.toThrow();
  expect(database.setHistoryDownloadState.mock.calls.map(call => call.slice(3))).toEqual([
    [false], [true, historyCoverage(dayStart, dayEnd, last)]]);
  expect(database.publishManualScope).toHaveBeenCalledTimes(1);
  expect(ends).toEqual(['cancelled']);
});

test('the next download of that day resumes after the kept prefix', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const last = dayStart + 9 * 3600000;
  const c = client(() => Promise.resolve({ data: [], error: null }));
  const { database } = store([{ slave_id: 6, day: dayKey(new Date(dayStart)), complete: 1, ...historyCoverage(dayStart, dayEnd, last) }]);
  const cloud = createHistoryCloud({ client: c, database, owner: 'a', runManual });
  await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 5 * 3600000 });
  // Not marked incomplete again, and the day's window starts at the prefix.
  expect(database.setHistoryDownloadState.mock.calls.map(call => call[3])).toEqual([true]);
  expect(startOf(c.calls[0])).toBe(last - TAIL_OVERLAP_MS);
});

test('cancelled before any page of the day was saved, nothing is published', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const c = client((log, signal) => hang(signal));
  const { database } = store();
  const cloud = createHistoryCloud({ client: c, database, owner: 'a', runManual });
  const controller = new AbortController();
  const running = cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 5 * 3600000, signal: controller.signal });
  while (c.calls.length < 1) await new Promise(resolve => setTimeout(resolve, 0));
  expect(startOf(c.calls[0])).toBe(dayStart - DOWNLOAD_BEFORE_MS);
  controller.abort();
  await expect(running).rejects.toThrow();
  expect(database.setHistoryDownloadState.mock.calls.map(call => call[3])).toEqual([false]);
  expect(database.publishManualScope).not.toHaveBeenCalled();
});

test('cancelled while waiting for the sync slot, the slot is given back at once', async () => {
  jest.useRealTimers();
  let release;
  const slot = new Promise(resolve => { release = resolve; });
  const waiting = async (work, abort) => { await slot; if (abort.signal.aborted) throw new Error('cancelled'); return work(() => true); };
  const { database } = store();
  const cloud = createHistoryCloud({ client: client(() => Promise.resolve({ data: [], error: null })), database, owner: 'a', runManual: waiting });
  const controller = new AbortController();
  const running = cloud.download({ slaveId: 6, dayStart: 0, dayEnd: DAY_MS, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  release();
  await expect(running).rejects.toThrow('cancelled');
  expect(database.setHistoryDownloadState).not.toHaveBeenCalled();
});
