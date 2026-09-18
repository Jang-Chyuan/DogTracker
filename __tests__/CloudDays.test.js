import { CLOUD_DAY_LIMIT, listCloudDays, mergeDays } from '../src/mapHistory/CloudDays';

const DAY = 24 * 3600000;
const NOW = new Date(2026, 8, 18, 15, 0).getTime();
const today = new Date(2026, 8, 18).getTime();

// The walk asks for the newest row before a cutoff; this stands in for the
// table, answering with the newest row it holds before that moment.
function fakeClient(times, { failAfter = null } = {}) {
  const calls = [];
  return {
    calls,
    from() {
      const filters = {};
      const query = {
        select: () => query,
        in: (column, values) => { filters[column] = values; return query; },
        lt: (_, value) => { filters.before = Date.parse(value); return query; },
        order: (column, options) => { filters.order = [column, options]; return query; },
        limit: value => { filters.limit = value; return query; },
        abortSignal: () => query,
        then: resolve => {
          calls.push(filters);
          if (failAfter != null && calls.length > failAfter) {
            return resolve({ error: new Error('offline') });
          }
          const found = times.filter(time => time < filters.before);
          return resolve({ data: found.length
            ? [{ received_at: new Date(Math.max(...found)).toISOString() }] : [] });
        },
      };
      return query;
    },
  };
}

test('the walk returns the days that hold rows, newest first, one query each', async () => {
  const times = [
    today + 9 * 3600000, today + 30000,
    today - DAY + 20 * 3600000,
    // Nothing on 9/16; the walk jumps straight over it.
    today - 3 * DAY + 5 * 3600000,
  ];
  const client = fakeClient(times);
  const { days, stopped } = await listCloudDays({ client, masters: [5, 7], slaves: [4], now: NOW });
  expect(days).toEqual([
    { day: today }, { day: today - DAY }, { day: today - 3 * DAY },
  ]);
  expect(stopped).toBe('end');
  // One query per day that exists, plus the one that finds nothing older.
  expect(client.calls).toHaveLength(4);
  expect(client.calls[0].master_id).toEqual([5, 7]);
  expect(client.calls[0].slave_id).toEqual([4]);
  expect(client.calls[0].limit).toBe(1);
  expect(client.calls[0].order).toEqual(['received_at', { ascending: false }]);
});

test('each day is reported as it is found, not held back until the walk ends', async () => {
  const times = [today + 3600000, today - DAY + 3600000, today - 2 * DAY + 3600000];
  const client = fakeClient(times);
  const seen = [];
  // One query takes about two seconds against the real table, so a card that
  // waits for all of them looks like it is doing nothing.
  const { days } = await listCloudDays({ client, masters: [7], slaves: [4], now: NOW,
    onDay: (day, found) => seen.push([day, found.length]) });
  expect(seen).toEqual([
    [today, 1], [today - DAY, 2], [today - 2 * DAY, 3],
  ]);
  expect(days).toHaveLength(3);
});

test('the walk stops at the cap instead of paging back forever', async () => {
  const times = Array.from({ length: 40 }, (_, index) => today - index * DAY + 3600000);
  const client = fakeClient(times);
  const { days, stopped } = await listCloudDays({ client, masters: [7], slaves: [4], now: NOW });
  expect(days).toHaveLength(CLOUD_DAY_LIMIT);
  expect(stopped).toBe('limit');
  expect(client.calls).toHaveLength(CLOUD_DAY_LIMIT);
});

test('a failed answer ends the walk without claiming the earlier days are empty', async () => {
  const times = [today + 3600000, today - DAY + 3600000];
  const client = fakeClient(times, { failAfter: 1 });
  // The days it never got to are unknown, not empty, and the card says so:
  // on the real table a timed-out question looked exactly like "nothing older".
  expect(await listCloudDays({ client, masters: [7], slaves: [4], now: NOW }))
    .toEqual({ days: [{ day: today }], stopped: 'error', message: 'offline' });
});

test('nothing is asked without a client or a device selection', async () => {
  expect(await listCloudDays({ client: null, masters: [7], slaves: [4] }))
    .toEqual({ days: [], stopped: 'end' });
  const client = fakeClient([today]);
  expect(await listCloudDays({ client, masters: [], slaves: [4], now: NOW }))
    .toEqual({ days: [], stopped: 'end' });
  expect(client.calls).toHaveLength(0);
});

test('days the phone does not hold are kept and marked', () => {
  const local = [{ day: today, rows: 800, from: today + 3600000, to: today + 7200000 }];
  const merged = mergeDays(local, [{ day: today }, { day: today - DAY }]);
  expect(merged).toEqual([
    { day: today, rows: 800, inCloud: true, from: today + 3600000, to: today + 7200000 },
    // Cloud only: the card offers it and says it is not downloaded, instead of
    // pretending the day does not exist.
    { day: today - DAY, rows: 0, inCloud: true, from: today - DAY, to: today - 1 },
  ]);
});
