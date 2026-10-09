// 054b: what the history's calendar asks Supabase, and its downloads through
// the sync's slot.
import { createHistoryCloud, DOWNLOAD_AFTER_MS, DOWNLOAD_BEFORE_MS } from '../src/mapHistory/HistoryCloud';

function client(answers) {
  const calls = [];
  const builder = log => {
    const q = {};
    for (const name of ['select', 'eq', 'gte', 'lt', 'gt', 'or', 'order', 'limit']) {
      q[name] = (...args) => { log.push([name, ...args]); return q; };
    }
    q.abortSignal = signal => { log.push(['abortSignal']); return answers(log, signal); };
    return q;
  };
  return { calls, from: table => { const log = [['from', table]]; calls.push(log); return builder(log); } };
}

test('the newest row before a cutoff, for one dog, by upload time', async () => {
  const c = client(() => Promise.resolve({ data: [{ received_at: '2026-10-03T01:00:00Z' }], error: null }));
  const cloud = createHistoryCloud({ client: c, database: {}, owner: 'u' });
  const time = await cloud.newestBefore({ slaveId: 6, cutoff: Date.parse('2026-10-08T00:00:00Z'),
    since: Date.parse('2026-09-27T00:00:00Z') });
  expect(time).toBe(Date.parse('2026-10-03T01:00:00Z'));
  expect(c.calls[0]).toEqual(expect.arrayContaining([['from', 'dog_telemetry'], ['eq', 'slave_id', 6],
    ['gte', 'received_at', '2026-09-27T00:00:00.000Z'], ['lt', 'received_at', '2026-10-08T00:00:00.000Z'],
    ['order', 'received_at', { ascending: false }], ['limit', 1]]));
  const none = createHistoryCloud({ client: client(() => Promise.resolve({ data: [], error: null })), database: {}, owner: 'u' });
  expect(await none.earliest({ slaveId: 6 })).toBe(null);
});

test('an unanswered question fails after its limit; an error answer fails', async () => {
  jest.useFakeTimers();
  const hang = client((log, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))));
  const cloud = createHistoryCloud({ client: hang, database: {}, owner: 'u', questionMs: 10000 });
  const asked = cloud.earliest({ slaveId: 6 });
  jest.advanceTimersByTime(10000);
  await expect(asked).rejects.toThrow('逾時');
  jest.useRealTimers();
  const bad = createHistoryCloud({ client: client(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    database: {}, owner: 'u' });
  await expect(bad.earliest({ slaveId: 6 })).rejects.toThrow('boom');
});

test('downloads one at a time through the slot; the day reaches past midnight by upload time', async () => {
  const windows = [];
  const c = client(log => {
    windows.push(log.filter(([name]) => name === 'gte' || name === 'lt' || name === 'eq'));
    return Promise.resolve({ data: [], error: null });
  });
  const database = { initialize: jest.fn(async () => {}), savePage: jest.fn(async () => {}) };
  let busy = false;
  const releases = [];
  // Like CloudSync.runManual: refuses while another manual download holds the slot.
  const runManual = async (work, abort) => {
    if (busy) throw new Error('已有下載進行中');
    busy = true;
    try {
      await new Promise(resolve => releases.push(resolve));
      if (abort.signal.aborted) throw new Error('下載已取消');
      return await work(() => true);
    } finally { busy = false; }
  };
  const cloud = createHistoryCloud({ client: c, database, owner: 'u', runManual });
  const first = new AbortController();
  const dayStart = Date.parse('2026-09-27T16:00:00Z'), dayEnd = dayStart + 86400000;
  const a = cloud.download({ slaveId: 6, dayStart, dayEnd, signal: first.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  first.abort();
  const b = cloud.download({ slaveId: 6, dayStart: dayEnd, dayEnd: dayEnd + 86400000, signal: new AbortController().signal });
  releases.shift()();
  await expect(a).rejects.toThrow('下載已取消');
  await new Promise(resolve => setTimeout(resolve, 0));
  releases.shift()();
  await expect(b).resolves.toBe(0);
  expect(windows[0]).toEqual(expect.arrayContaining([['eq', 'slave_id', 6],
    ['gte', 'received_at', new Date(dayEnd - DOWNLOAD_BEFORE_MS).toISOString()],
    ['lt', 'received_at', new Date(dayEnd + 86400000 + DOWNLOAD_AFTER_MS).toISOString()]]));
});

test('K11: incomplete download is durable before network writes and complete only after success', async () => {
  const order = [];
  const database = { initialize: async () => {}, savePage: async () => {},
    setHistoryDownloadState: jest.fn(async (owner, id, day, complete) => order.push(complete)),
    historyDownloadStates: async () => [{ slave_id: 6, day: '2026-10-03', complete: 0 }] };
  const c = client(() => { expect(order.at(-1)).toBe(false); return Promise.resolve({ data: [], error: null }); });
  const cloud = createHistoryCloud({ client: c, database, owner: 'a' });
  const dayStart = new Date(2026, 9, 3).getTime();
  await cloud.download({ slaveId: 6, dayStart, dayEnd: dayStart + 86400000 });
  expect(order).toEqual([false, true]);
  expect(await cloud.downloadStates({ slaveId: 6 })).toEqual([{ slave_id: 6, day: '2026-10-03', complete: 0 }]);
  order.length = 0;
  const failed = createHistoryCloud({ client: client(() => Promise.resolve({ data: null, error: { message: 'failed' } })), database, owner: 'a' });
  await expect(failed.download({ slaveId: 6, dayStart, dayEnd: dayStart + 86400000 })).rejects.toThrow('下載失敗');
  expect(order).toEqual([false]);
});

test('K12: multi-dog downloads complete each dog independently and report exactly which failed', async () => {
  const statuses = [];
  const complete = [];
  const c = client(log => {
    const id = log.find(([key, name]) => key === 'eq' && name === 'slave_id')[2];
    return Promise.resolve(id === 6 ? { data: null, error: { message: 'offline' } } : { data: [], error: null });
  });
  const database = { initialize: async () => {}, setHistoryDownloadState: async (owner, id, day, done) => complete.push([id, done]) };
  const cloud = createHistoryCloud({ client: c, database, owner: 'a' });
  await expect(cloud.download({ slaveId: [4, 6], dayStart: 0, dayEnd: 86400000, onDogEnd: (id, status) => statuses.push([id, status]) })).rejects.toThrow('下載失敗');
  expect(statuses).toEqual([[4, 'done'], [6, 'failed']]);
  expect(complete).toEqual([[4, false], [6, false], [4, true]]);
});
