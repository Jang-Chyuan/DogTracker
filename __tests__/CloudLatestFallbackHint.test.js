import { createClient } from '@supabase/supabase-js';
import { downloadCloudLatest } from '../src/cloud/CloudLatest';
import { downloadCloudLatestSerial } from '../__fixtures__/CloudLatestSerial';

const CUT = Date.parse('2026-10-12T12:00:00Z');
const event = (id, slave, received, extra = {}) => ({
  event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  master_id: 7, slave_id: slave, seq: id, received_at: received,
  payload: { lat: 25000000, lon: 121000000 }, ...extra,
});
const stamp = text => [Date.parse(text), Number((/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(text)?.[1] || '').padEnd(6, '0').slice(3))];
const compare = (a, b) => {
  if (typeof a === 'string' && /^\d{4}-/.test(a)) {
    const left = stamp(a), right = stamp(b);
    return left[0] - right[0] || left[1] - right[1];
  }
  return a < b ? -1 : a > b ? 1 : 0;
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const response = data => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify(data) });
const isKey = p => p.get('order')?.startsWith('slave_id.asc');
const isFixed = p => p.has('payload->lat');
const isPhone = p => p.get('upload_source') === 'eq.phone';

// Installed SDK builds the actual URL, filters, ordering, limit and AbortSignal.
// The invented REST transport has a one-row server page; it does not infer
// discovery from the select projection or assume every discovery is fallback.
function sdk(rows, intercept = async () => undefined) {
  const calls = [], client = createClient('https://example.invalid', 'public-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      const p = new URL(url).searchParams;
      const call = { p, signal: options.signal }; calls.push(call);
      const overridden = await intercept(call);
      if (overridden !== undefined) return overridden?.ok === false ? overridden : response(overridden);
      let data = rows.filter(row => {
        if (!p.get('master_id').slice(4, -1).split(',').map(Number).includes(row.master_id)) return false;
        if (compare(row.received_at, p.get('received_at').slice(3)) >= 0) return false;
        const slave = p.get('slave_id');
        if (slave?.startsWith('gt.') && row.slave_id <= Number(slave.slice(3))) return false;
        if (slave?.startsWith('eq.') && row.slave_id !== Number(slave.slice(3))) return false;
        if (isPhone(p) && (row.upload_source !== 'phone' || row.phone_received_at == null)) return false;
        if (p.has('or')) {
          const fallback = row.upload_source !== 'phone' || row.phone_received_at == null;
          const nonzero = row.payload?.lat !== 0 || row.payload?.lon !== 0;
          if (p.get('or').includes('upload_source') && !fallback) return false;
          if (p.get('or').includes('payload->lat') && !nonzero) return false;
        }
        for (const field of ['lat', 'lon']) for (const filter of p.getAll(`payload->${field}`)) {
          const value = row.payload?.[field], bound = Number(filter.slice(4));
          if (typeof value !== 'number' || (filter.startsWith('gte.') ? value < bound : value > bound)) return false;
        }
        return true;
      });
      const order = p.get('order').split(',').map(value => value.split('.'));
      data.sort((a, b) => {
        for (const [field, direction] of order) {
          const result = compare(a[field], b[field]);
          if (result) return direction === 'desc' ? -result : result;
        }
        return 0;
      });
      data = data.slice(0, Math.min(1, Number(p.get('limit'))));
      if (p.get('select') === 'slave_id') data = data.map(row => ({ slave_id: row.slave_id }));
      return response(data);
    } },
  });
  return { client, calls };
}
const run = f => downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT });

test('six silent legacy dogs keep the full low-page roster while discovery saves exactly six packet GETs', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => event(index + 1, index + 1, '2026-10-10T01:00:00Z'));
  const original = sdk(rows), f = sdk(rows);
  const expected = await downloadCloudLatestSerial({ client: original.client, masterIds: [7], cutoff: CUT });
  expect(await run(f)).toEqual(expected);
  expect(original.calls).toHaveLength(19);
  expect(f.calls.length).toBe(13);
  expect(f.calls.filter(c => !isKey(c.p) && !isPhone(c.p))).toHaveLength(0);
  expect(f.calls.filter(c => isPhone(c.p))).toHaveLength(6);
  expect(f.calls.filter(c => isKey(c.p))).toHaveLength(7);
  const first = f.calls[0].p;
  expect(first.get('select')).toContain('payload');
  expect(first.get('order')).toBe('slave_id.asc,received_at.desc,event_id.desc');
  expect(first.get('limit')).toBe('1');
});

test('top discovery from the phone stream is not a fallback hint; both packet clocks and their original winner remain', async () => {
  const rows = [event(1, 4, '2026-10-12T10:00:00Z', { upload_source: 'wifi' }),
    event(2, 4, '2026-10-12T11:59:00Z', { upload_source: 'phone', phone_received_at: '2026-10-11T01:00:00Z' })];
  const f = sdk(rows);
  expect((await run(f)).dogs[0].packet.sequence).toBe(1);
  expect(f.calls.filter(c => !isKey(c.p))).toHaveLength(2);
  expect(f.calls.filter(c => !isKey(c.p) && !isPhone(c.p))).toHaveLength(1);
});

test.each([undefined, null, 'wifi'])('fallback source %s with a phone timestamp uses received clock and still waits for delayed phone', async source => {
  const phone = deferred(), rows = [event(1, 4, '2026-10-12T11:00:00.123450Z',
    { upload_source: source, phone_received_at: '2026-10-11T01:00:00Z' }),
  event(2, 4, '2026-10-12T10:00:00Z', { upload_source: 'phone', phone_received_at: '2026-10-12T19:00:00.123451+08:00' })];
  const f = sdk(rows, async ({ p }) => { if (isPhone(p)) await phone.promise; });
  let settled = false; const task = run(f); task.then(() => { settled = true; }, () => { settled = true; });
  await flush(); expect(settled).toBe(false);
  expect(f.calls.filter(c => !isKey(c.p) && !isPhone(c.p))).toHaveLength(0);
  phone.resolve(); expect((await task).dogs[0].packet.sequence).toBe(2);
});

test('null phone clock remains fallback and missing GPS still fetches both independent last-valid-fix streams', async () => {
  const rows = [event(1, 4, '2026-10-10T01:00:00Z'),
    event(2, 4, '2026-10-12T11:00:00Z', { upload_source: 'phone', phone_received_at: null, payload: { lat: 0, lon: 0 } }),
    event(3, 4, '2026-10-09T01:00:00Z', { upload_source: 'phone', phone_received_at: '2026-10-11T01:00:00Z' })];
  const f = sdk(rows), result = await run(f);
  expect(result.dogs[0]).toMatchObject({ packet: { sequence: 2 }, fix: { sequence: 3 } });
  expect(f.calls.filter(c => isFixed(c.p))).toHaveLength(2);
  expect(f.calls.filter(c => !isKey(c.p) && !isFixed(c.p))).toHaveLength(1);
});

test.each(['coordinate', 'master', 'timestamp', 'payload'])('malformed discovery hint %s cannot become a publishable packet', async bad => {
  const row = event(1, 4, '2026-10-12T11:00:00Z');
  const changed = { ...row, ...(bad === 'coordinate' ? { payload: { lat: '25', lon: 121000000 } }
    : bad === 'master' ? { master_id: 99 } : bad === 'timestamp' ? { received_at: 'invalid' } : { payload: null }) };
  const f = sdk([row], async ({ p }) => isKey(p) && !p.has('slave_id') ? [changed] : undefined);
  await expect(run(f)).rejects.toThrow();
});

test.each(['signal', 'owner'])('hint cannot release a complete snapshot after %s cancellation while the phone ignores abort', async cause => {
  const phone = deferred(), controller = new AbortController(); let current = true;
  const f = sdk([event(1, 4, '2026-10-12T11:00:00Z')], async ({ p }) => {
    if (isPhone(p)) { await phone.promise; return []; }
  });
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT, signal: controller.signal,
    check: () => { if (!current) throw new Error('invented old owner'); } });
  task.catch(() => {}); await flush();
  if (cause === 'signal') controller.abort(); else { current = false; phone.resolve(); }
  await expect(task).rejects.toThrow();
  phone.resolve(); await flush();
  expect(f.calls.every(c => c.signal.aborted)).toBe(true);
});


test.each([
  ['microseconds', '2026-10-12T11:00:00.123450Z', '2026-10-12T19:00:00.123451+08:00', 1, 2],
  ['event tie', '2026-10-12T11:00:00.123456Z', '2026-10-12T19:00:00.123456+08:00', 8, 9],
])('discovery fallback ordering keeps %s precision before hint reuse', async (_case, firstTime, nextTime, firstId, nextId) => {
  const rows = [event(firstId, 4, firstTime), event(nextId, 4, nextTime)];
  const f = sdk(rows), old = sdk(rows);
  expect(await run(f)).toEqual(await downloadCloudLatestSerial({ client: old.client, masterIds: [7], cutoff: CUT }));
  expect((await run(sdk(rows))).dogs[0].packet.sequence).toBe(nextId);
  expect(f.calls.length).toBe(3);
});

test('a hinted fallback cannot hide a phone stream REST error or accept a partly known snapshot', async () => {
  const f = sdk([event(1, 4, '2026-10-12T11:00:00Z')], async ({ p }) => isPhone(p) ? {
    ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => null },
    text: async () => JSON.stringify({ message: 'invented denied phone stream' }),
  } : undefined);
  await expect(run(f)).rejects.toMatchObject({ status: 401, cause: { message: 'invented denied phone stream' } });
  expect(f.calls.filter(c => isPhone(c.p)).length).toBe(1);
  expect(f.calls.every(c => c.signal.aborted)).toBe(true);
});

test('invalid nonnull phone clock is not fallback and remains rejected by the independent phone query', async () => {
  const f = sdk([event(1, 4, '2026-10-12T11:00:00Z', { upload_source: 'phone', phone_received_at: 'invalid' })]);
  await expect(run(f)).rejects.toThrow();
  expect(f.calls.filter(c => !isKey(c.p) && !isPhone(c.p)).length).toBe(1);
});

test('hinted workers retain prefetch four and reject queued keys when a held sibling returns an error', async () => {
  const phone = deferred();
  const rows = Array.from({ length: 10 }, (_, index) => event(index + 1, index + 1, '2026-10-11T01:00:00Z'));
  const f = sdk(rows, async ({ p }) => {
    if (isPhone(p)) {
      await phone.promise;
      if (p.get('slave_id') === 'eq.1') return {
        ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => null },
        text: async () => JSON.stringify({ message: 'invented first dog denied' }),
      };
    }
  });
  const task = run(f); task.catch(() => {}); for (let turn = 0; turn < 10; turn++) await flush();
  expect(f.calls.filter(c => isKey(c.p)).length).toBe(6);
  expect(f.calls.filter(c => isPhone(c.p)).map(c => c.p.get('slave_id'))).toEqual(['eq.1', 'eq.2']);
  const before = f.calls.length;
  phone.resolve(); await expect(task).rejects.toThrow(); await flush();
  expect(f.calls.length).toBe(before);
  expect(f.calls.every(c => c.signal.aborted)).toBe(true);
});


test.each([false, true])('six discovered dogs with two no-GPS packets keep fixes; mixed phone tops=%s bound the actual savings', async mixed => {
  const rows = Array.from({ length: 6 }, (_, index) => [
    event(index * 3 + 1, index + 1, '2026-10-10T01:00:00Z'),
    event(index * 3 + 2, index + 1, '2026-10-11T01:00:00Z', index < 2 ? { payload: { lat: 0, lon: 0 } } : {}),
    ...(mixed && index < 3 ? [event(index * 3 + 3, index + 1, '2026-10-12T11:59:00Z',
      { upload_source: 'phone', phone_received_at: '2026-10-09T01:00:00Z' })] : []),
  ]).flat();
  const f = sdk(rows), original = sdk(rows);
  const expected = await downloadCloudLatestSerial({ client: original.client, masterIds: [7], cutoff: CUT });
  expect(await run(f)).toEqual(expected);
  expect(original.calls.length).toBe(23);
  expect(f.calls.length).toBe(mixed ? 20 : 17);
  expect(f.calls.filter(c => isFixed(c.p)).length).toBe(4);
  expect(f.calls.filter(c => isPhone(c.p) && !isFixed(c.p)).length).toBe(6);
});
