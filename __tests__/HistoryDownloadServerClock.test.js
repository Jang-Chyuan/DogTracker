// A dog-history download is cut on the server's clock (2026-10-15, #186's
// ServerClock): received_at is the server's time, the screen's cutoff this
// phone's. A phone running fast used to prove rows "received" up to a time
// the server had not reached, and the next download's tail started past the
// rows the server received meanwhile. And a request that fails part way keeps
// the prefix it saved, as a cancel does (#174), so 重試 resumes from there.
import { createHistoryCloud, DOWNLOAD_BEFORE_MS, TAIL_OVERLAP_MS } from '../src/mapHistory/HistoryCloud';
import { coversHistory, historyCoverage, HISTORY_CONTEXT_AFTER_MS } from '../src/cloud/HistoryCoverage';
import { dayKey } from '../src/history/screen/HistoryScreenDates';

const DAY_MS = 86400000, MINUTE = 60000;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const telemetry = (n, time) => ({ event_id: uuid(n), master_id: 7, slave_id: 6, seq: n, received_at: new Date(time).toISOString(),
  payload: { lat: 10000000, lon: 20000000, satellites: 9 }, rssi: -70, snr: 5, upload_source: 'master', phone_received_at: null });
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
const bound = (log, name) => Date.parse(log.find(([key, column]) => key === name && column === 'received_at')[2]);
function store(states = []) {
  return { initialize: async () => {}, beginManualScope: jest.fn(async () => {}), savePage: jest.fn(async () => {}),
    historyDownloadStates: jest.fn(async () => states), setHistoryDownloadState: jest.fn(async () => {}),
    publishManualScope: jest.fn(async () => ({ dataRevision: 1 })) };
}
const runManual = (work, abort) => work(() => !abort.signal.aborted, commit => commit());

test('the reception bound of a proof is on the server clock; the day bounds stay on the phone clock', () => {
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS, cutoff = dayStart + 10 * 3600000;
  expect(historyCoverage(dayStart, dayEnd, cutoff)).toEqual({ range_start: dayStart, range_end: cutoff, received_before: cutoff });
  expect(historyCoverage(dayStart, dayEnd, cutoff, -10 * MINUTE))
    .toEqual({ range_start: dayStart, range_end: cutoff, received_before: cutoff - 10 * MINUTE });
  // A closed day reaches its fixed end either way.
  expect(historyCoverage(dayStart, dayEnd, dayEnd + 5 * 3600000, -10 * MINUTE).received_before).toBe(dayEnd + HISTORY_CONTEXT_AFTER_MS);
  expect(historyCoverage(dayStart, dayEnd, cutoff, NaN).received_before).toBe(cutoff);
});

test('a phone 10 minutes fast cuts today\'s download where the server is, and the next tail starts there', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const cutoff = dayStart + 10 * 3600000, serverOffset = -10 * MINUTE, server = cutoff + serverOffset;
  const c = client(() => Promise.resolve({ data: [], error: null }));
  const database = store();
  const cloud = createHistoryCloud({ client: c, database, owner: 'a', runManual });
  await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff, serverOffset });
  expect(bound(c.calls[0], 'lt')).toBe(server);
  const proof = database.setHistoryDownloadState.mock.calls.at(-1)[4];
  expect(proof).toEqual({ range_start: dayStart, range_end: cutoff, received_before: server });
  // The screen checks the same day at the same cutoff with the same offset.
  expect(coversHistory({ complete: 1, ...proof }, historyCoverage(dayStart, dayEnd, cutoff, serverOffset))).toBe(true);
  // A minute later the tail starts from that proof (not past the rows the
  // server received in the 10 minutes the phone was ahead).
  const next = client(() => Promise.resolve({ data: [], error: null }));
  const later = store([{ slave_id: 6, day: dayKey(new Date(dayStart)), complete: 1, ...proof }]);
  await createHistoryCloud({ client: next, database: later, owner: 'a', runManual })
    .download({ slaveId: 6, dayStart, dayEnd, cutoff: cutoff + MINUTE, serverOffset });
  expect(bound(next.calls[0], 'gte')).toBe(server - TAIL_OVERLAP_MS);
  expect(bound(next.calls[0], 'lt')).toBe(server + MINUTE);
  expect(later.setHistoryDownloadState.mock.calls.map(call => call[3])).toEqual([true]);
});

test('a phone running slow keeps resuming from its prefix too', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const cutoff = dayStart + 10 * 3600000, serverOffset = 5 * MINUTE;
  const proof = historyCoverage(dayStart, dayEnd, cutoff, serverOffset);
  const c = client(() => Promise.resolve({ data: [], error: null }));
  const database = store([{ slave_id: 6, day: dayKey(new Date(dayStart)), complete: 1, ...proof }]);
  await createHistoryCloud({ client: c, database, owner: 'a', runManual })
    .download({ slaveId: 6, dayStart, dayEnd, cutoff: cutoff + MINUTE, serverOffset });
  expect(bound(c.calls[0], 'gte')).toBe(proof.received_before - TAIL_OVERLAP_MS);
});

test('a request that fails part way keeps the pages saved before it as a completed prefix', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const last = dayStart + 9 * 3600000;
  const c = client(log => Promise.resolve(log.some(([name]) => name === 'or')
    ? { data: null, error: { message: 'Network request failed' } }
    : { data: [telemetry(1, dayStart + 8 * 3600000), telemetry(2, last)], error: null }));
  const database = store();
  const ends = [];
  const cloud = createHistoryCloud({ client: c, database, owner: 'a', runManual });
  await expect(cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 5 * 3600000, serverOffset: 0,
    onDogEnd: (id, status) => ends.push(status) })).rejects.toThrow();
  expect(ends).toEqual(['failed']);
  expect(database.setHistoryDownloadState.mock.calls.map(call => call.slice(3))).toEqual([
    [false], [true, historyCoverage(dayStart, dayEnd, last)]]);
  expect(database.publishManualScope).toHaveBeenCalledTimes(1);
  // 重試 resumes after it.
  const retry = client(() => Promise.resolve({ data: [], error: null }));
  const kept = store([{ slave_id: 6, day: dayKey(new Date(dayStart)), complete: 1, ...historyCoverage(dayStart, dayEnd, last) }]);
  await createHistoryCloud({ client: retry, database: kept, owner: 'a', runManual })
    .download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 5 * 3600000, serverOffset: 0 });
  expect(bound(retry.calls[0], 'gte')).toBe(last - TAIL_OVERLAP_MS);
});

test('a failure before any page of the window was saved keeps nothing', async () => {
  jest.useRealTimers();
  const dayStart = new Date(2026, 9, 12).getTime(), dayEnd = dayStart + DAY_MS;
  const c = client(() => Promise.resolve({ data: null, error: { message: 'Network request failed' } }));
  const database = store();
  await expect(createHistoryCloud({ client: c, database, owner: 'a', runManual })
    .download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 5 * 3600000, serverOffset: 0 })).rejects.toThrow();
  expect(bound(c.calls[0], 'gte')).toBe(dayStart - DOWNLOAD_BEFORE_MS);
  expect(database.setHistoryDownloadState.mock.calls.map(call => call[3])).toEqual([false]);
  expect(database.publishManualScope).not.toHaveBeenCalled();
});
