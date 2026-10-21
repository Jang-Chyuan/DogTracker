import { downloadCloudLatest, ROSTER_WINDOW_MS } from '../src/cloud/CloudLatest';
import { downloadCloudLatestSerial } from '../__fixtures__/CloudLatestSerial';

const CUT = Date.parse('2026-10-10T12:00:00Z');
const event = (id, slave, master, received, payload = { lat: 25000000, lon: 121000000 }, extra = {}) => ({
  event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, master_id: master,
  slave_id: slave, seq: id, received_at: received, payload, ...extra,
});
function rest(events) {
  const calls = [];
  const client = { from: jest.fn(table => {
    const filters = [], order = []; let fields, size;
    const query = { table, filters, orders: order };
    query.select = value => { fields = value; return query; };
    query.limit = value => { size = value; return query; };
    query.order = (key, options) => { order.push([key, options]); return query; };
    for (const method of ['in', 'eq', 'gt', 'lt', 'gte', 'lte', 'not', 'or']) query[method] = (...args) => {
      filters.push([method, ...args]); return query;
    };
    query.abortSignal = async () => {
      let found = events.filter(row => filters.every(([method, key, value]) => {
        const prop = key.startsWith('payload->') ? row.payload[key.slice(9)] : row[key];
        if (method === 'in') return value.includes(prop);
        if (method === 'eq') return prop === value;
        if (method === 'gt') return prop > value;
        if (method === 'lt') return Date.parse(prop) < Date.parse(value);
        if (method === 'gte') return key.endsWith('_at') ? Date.parse(prop) >= Date.parse(value) : typeof prop === 'number' && prop >= value;
        if (method === 'lte') return typeof prop === 'number' && prop <= value;
        if (method === 'not') return prop != null;
        if (method === 'or') {
          const fallback = row.upload_source !== 'phone' || row.phone_received_at == null;
          const nonzero = row.payload.lat !== 0 || row.payload.lon !== 0;
          return key.startsWith('and(') ? fallback && nonzero : key.startsWith('upload_source') ? fallback : nonzero;
        }
        throw new Error('unexpected REST operator');
      }));
      found.sort((a, b) => {
        for (const [key, options] of order) {
          const clock = value => {
            const match = /\.(\d{1,6})/.exec(value)?.[1] || '';
            return `${String(Date.parse(value)).padStart(16, '0')}:${match.padEnd(6, '0').slice(3)}`;
          };
          const left = key.endsWith('_at') ? clock(a[key]) : a[key];
          const right = key.endsWith('_at') ? clock(b[key]) : b[key];
          const result = left < right ? -1 : left > right ? 1 : 0;
          if (result) return options?.ascending === false ? -result : result;
        }
        return 0;
      });
      return { data: found.slice(0, size).map(row => fields === 'slave_id' ? { slave_id: row.slave_id } : row) };
    };
    calls.push(query); return query;
  }) };
  return { client, calls };
}

test('key seeks find all dogs of permitted masters, including silent and no-fix dogs not listed as members', async () => {
  const rows = [event(1, 4, 7, '2026-10-09T01:00:00Z'), event(2, 6, 7, '2026-10-10T11:00:00Z', { lat: 0, lon: 0 }),
    event(3, 8, 9, '2026-10-10T11:00:00Z'), event(4, 99, 10, '2026-10-10T11:00:00Z')];
  const { client, calls } = rest(rows);
  const result = await downloadCloudLatest({ client, masterIds: [7, 9], cutoff: CUT });
  expect(result.dogs.map(dog => dog.slaveId)).toEqual([4, 6, 8]);
  expect(result.dogs[0].fix.track_at).toBe(Date.parse(rows[0].received_at));
  expect(result.dogs[1]).toMatchObject({ packet: { slave_id: 6 }, fix: null });
  expect(calls.filter(q => q.orders[0]?.[0] === 'slave_id')).toHaveLength(4);
  expect(calls.some(q => q.filters.some(f => f[0] === 'gt' && f[2] === 6))).toBe(true);
});

test('late phone uploads and multiple masters use effective clocks; packet without GPS retains a separate old valid fix', async () => {
  const { client } = rest([
    event(1, 4, 7, '2026-10-10T11:59:00Z', { lat: 25000001, lon: 121000001 },
      { upload_source: 'phone', phone_received_at: '2026-10-10T09:00:00Z' }),
    event(2, 4, 9, '2026-10-10T10:00:00Z', { lat: 25000002, lon: 121000002 }, { upload_source: 'wifi' }),
    event(3, 4, 9, '2026-10-10T11:00:00Z', { lat: 0, lon: 0 }, { upload_source: 'phone', phone_received_at: null }),
    event(4, 4, 7, '2026-10-10T12:01:00Z'),
  ]);
  const result = await downloadCloudLatest({ client, masterIds: [7, 9], cutoff: CUT });
  expect(result.dogs[0]).toMatchObject({ packet: { sequence: 3 }, fix: { sequence: 2 } });
});

test('malformed JSON coordinate types and out-of-range coordinates cannot become a valid last fix', async () => {
  const { client } = rest([event(1, 4, 7, '2026-10-10T09:00:00Z'),
    event(2, 4, 7, '2026-10-10T10:00:00Z', { lat: 91000000, lon: 121000000 }),
    event(3, 4, 7, '2026-10-10T11:00:00Z', { lat: 0, lon: 0 }),
    event(4, 4, 7, '2026-10-10T10:30:00Z', { lat: '25000000', lon: 121000000 })]);
  const result = await downloadCloudLatest({ client, masterIds: [7], cutoff: CUT });
  expect(result.dogs[0].fix.sequence).toBe(1);
  // An unreadable coordinate is a packet without a fix, not a failed snapshot
  // (2026-10-21, CloudMalformedTelemetry.test.js).
  const malformed = rest([event(9, 4, 7, '2026-10-10T11:00:00Z', { lat: '25', lon: 121000000 })]);
  const kept = await downloadCloudLatest({ client: malformed.client, masterIds: [7], cutoff: CUT });
  expect(kept.dogs[0]).toMatchObject({ packet: { sequence: 9, slave_lat: null, slave_lon: null }, fix: null });
});

test('empty membership yields a complete empty snapshot and canceled requests cannot return a snapshot', async () => {
  const { client } = rest([]);
  expect(await downloadCloudLatest({ client, masterIds: [], cutoff: CUT })).toEqual({ cutoff: CUT, dogs: [] });
  expect(client.from).not.toHaveBeenCalled();
  await expect(downloadCloudLatest({ client, masterIds: [7], cutoff: CUT,
    signal: { aborted: true } })).rejects.toThrow();
});


test.each([
  ['fraction', '2026-10-10T11:00:00.123450Z', '2026-10-10T19:00:00.123451+08:00'],
  ['event-id tie', '2026-10-10T11:00:00.123456Z', '2026-10-10T19:00:00.123456+08:00'],
])('%s preserves six digits and equal instants with different timezone offsets', async (_kind, received, phoneTime) => {
  const { client } = rest([event(8, 4, 7, received, undefined, { upload_source: 'wifi' }),
    event(9, 4, 9, received, undefined, { upload_source: 'phone', phone_received_at: phoneTime })]);
  const result = await downloadCloudLatest({ client, masterIds: [7, 9], cutoff: CUT });
  expect(result.dogs[0].packet.sequence).toBe(9);
});

test('a repeated dog key fails the whole result instead of returning a falsely complete collection', async () => {
  const { client } = rest([event(1, 4, 7, '2026-10-10T11:00:00Z')]);
  const from = client.from;
  client.from = jest.fn(table => {
    const query = from(table);
    query.gt = () => query;
    return query;
  });
  await expect(downloadCloudLatest({ client, masterIds: [7], cutoff: CUT })).rejects.toThrow();
});

test('cancellation and owner changes during a response cannot return a publishable snapshot', async () => {
  for (const cancel of ['signal', 'owner']) {
    const { client } = rest([event(1, 4, 7, '2026-10-10T11:00:00Z')]);
    const abort = new AbortController(); let current = true;
    const from = client.from;
    client.from = table => {
      const query = from(table), read = query.abortSignal;
      query.abortSignal = async signal => {
        const value = await read(signal);
        if (cancel === 'signal') abort.abort(); else current = false;
        return value;
      };
      return query;
    };
    await expect(downloadCloudLatest({ client, masterIds: [7], cutoff: CUT, signal: abort.signal,
      check: () => { if (!current) throw new Error('old owner'); } })).rejects.toThrow();
  }
});

test('the real Supabase SDK emits numeric JSON filters, master IN, key seek and independent clock streams', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const urls = []; let discovered = false;
  const sdk = createClient('https://example.invalid', 'public-fixture-key', { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  }, global: { fetch: async url => {
    const parsed = new URL(url); urls.push(parsed);
    const params = parsed.searchParams;
    let data;
    if (params.get('order')?.startsWith('slave_id.asc')) {
      data = discovered ? [] : [event(3, 4, 7, '2026-10-10T11:00:00Z', { lat: 0, lon: 0 })]; discovered = true;
    } else if (params.get('upload_source') === 'eq.phone') data = [];
    else data = [event(params.has('payload->lat') ? 1 : 3, 4, 7, '2026-10-10T11:00:00Z',
      params.has('payload->lat') ? { lat: 25000000, lon: 121000000 } : { lat: 0, lon: 0 })];
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => JSON.stringify(data) };
  } } });
  const result = await downloadCloudLatest({ client: sdk, masterIds: [7, 9], cutoff: CUT });
  expect(result.dogs[0]).toMatchObject({ packet: { sequence: 3 }, fix: { sequence: 1 } });
  expect(urls.every(url => url.searchParams.get('master_id') === 'in.(7,9)')).toBe(true);
  expect(urls.filter(url => url.searchParams.get('order')?.startsWith('slave_id.asc')).map(url => url.searchParams.get('slave_id')))
    .toEqual([null, 'gt.4']);
  const fixed = urls.find(url => url.searchParams.has('payload->lat'));
  expect(fixed.searchParams.getAll('payload->lat')).toEqual(['gte.-90000000', 'lte.90000000']);
  expect(fixed.searchParams.getAll('payload->lon')).toEqual(['gte.-180000000', 'lte.180000000']);
  expect(fixed.searchParams.get('or')).toContain('payload->lat.neq.0,payload->lon.neq.0');
  const phone = urls.find(url => url.searchParams.get('upload_source') === 'eq.phone');
  expect(phone.searchParams.get('phone_received_at')).toBe('not.is.null');
  expect(phone.searchParams.get('order')).toBe('phone_received_at.desc,received_at.desc,event_id.desc');
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const microtasks = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
// These legacy parallel/pipeline guards deliberately make discovery's top
// row a late old phone upload: no fallback hint is available, so both clock
// GETs remain real and the ignored-abort sibling cases still exercise two.
const withoutFallbackHint = events => [...events, ...[...new Set(events.map(row => row.slave_id))].map(slave =>
  event(900 + slave, slave, events.find(row => row.slave_id === slave).master_id,
    '2026-10-10T11:59:59Z', undefined, { upload_source: 'phone', phone_received_at: '2026-10-01T01:00:00Z' }))];
function heldStreams(events, gates) {
  const { client, calls } = rest(withoutFallbackHint(events));
  const original = client.from;
  const dispatched = [], signals = [];
  let active = 0, peak = 0;
  client.from = table => {
    const query = original(table), execute = query.abortSignal;
    query.abortSignal = async signal => {
      if (query.orders[0]?.[0] === 'slave_id') return execute(signal);
      const phone = query.filters.some(([method, key]) => method === 'eq' && key === 'upload_source');
      const fixed = query.filters.some(([method, key]) => method === 'gte' && key === 'payload->lat');
      const key = `${fixed ? 'fix' : 'packet'}-${phone ? 'phone' : 'fallback'}`;
      dispatched.push(key); signals.push(signal); peak = Math.max(peak, ++active);
      try { await gates[key].promise; return await execute(signal); }
      finally { active--; }
    };
    return query;
  };
  return { client, calls, dispatched, signals, peak: () => peak };
}
const streamGates = () => Object.fromEntries(['packet-fallback', 'packet-phone', 'fix-fallback', 'fix-phone'].map(key => [key, deferred()]));

test('phone and fallback requests start together, bounded to two; silent no-GPS dog still uses the ordered valid-fix pair', async () => {
  const gates = streamGates();
  const f = heldStreams([
    event(1, 4, 7, '2026-10-08T11:00:00Z'),
    event(2, 4, 7, '2026-10-09T11:00:00Z', { lat: 0, lon: 0 }),
    event(3, 4, 7, '2026-10-10T11:59:00Z', { lat: 25000001, lon: 121000001 },
      { upload_source: 'phone', phone_received_at: '2026-10-08T09:00:00Z' }),
  ], gates);
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT });
  task.catch(() => {});
  try {
    await microtasks();
    expect(f.dispatched).toEqual(['packet-fallback', 'packet-phone']);
    gates['packet-fallback'].resolve(); await microtasks();
    expect(f.dispatched).toHaveLength(2);
    gates['packet-phone'].resolve(); await microtasks();
    expect(f.dispatched).toEqual(['packet-fallback', 'packet-phone', 'fix-fallback', 'fix-phone']);
    gates['fix-phone'].resolve(); await microtasks();
    expect(f.calls.filter(q => q.orders[0]?.[0] === 'slave_id')).toHaveLength(2);
    gates['fix-fallback'].resolve();
    expect((await task).dogs[0]).toMatchObject({ slaveId: 4, packet: { sequence: 2 }, fix: { sequence: 1 } });
    expect(f.peak()).toBe(2);
    expect(f.calls.filter(q => q.orders[0]?.[0] === 'slave_id')).toHaveLength(2);
  } finally { Object.values(gates).forEach(gate => gate.resolve()); await task.catch(() => {}); }
});

test('a failed clock stream aborts its paired request and cannot return a partly selected dog', async () => {
  const gates = streamGates();
  const f = heldStreams([event(1, 4, 7, '2026-10-10T11:00:00Z')], gates);
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT });
  task.catch(() => {});
  try {
    await microtasks();
    expect(f.dispatched).toHaveLength(2);
    gates['packet-phone'].reject(new Error('synthetic stream failure'));
    await expect(task).rejects.toThrow('synthetic stream failure');
    expect(f.signals.every(signal => signal.aborted)).toBe(true);
    expect(f.calls.filter(q => q.orders[0]?.[0] === 'slave_id')).toHaveLength(2);
  } finally { Object.values(gates).forEach(gate => gate.resolve()); await task.catch(() => {}); }
});

test.each(['signal', 'owner'])('%s cancellation rejects both late parallel responses even when transport ignores abort', async cancellation => {
  const gates = streamGates();
  const f = heldStreams([event(1, 4, 7, '2026-10-10T11:00:00Z')], gates);
  const controller = new AbortController(); let currentOwner = true;
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT, signal: controller.signal,
    check: () => { if (!currentOwner) throw new Error('old synthetic owner'); } });
  task.catch(() => {});
  try {
    await microtasks(); expect(f.dispatched).toHaveLength(2);
    if (cancellation === 'signal') { controller.abort(); expect(f.signals.every(signal => signal.aborted)).toBe(true); }
    else currentOwner = false;
    gates['packet-phone'].resolve(); gates['packet-fallback'].resolve();
    await expect(task).rejects.toThrow();
    expect(f.signals.every(signal => signal.aborted)).toBe(true);
    expect(f.calls.filter(q => q.orders[0]?.[0] === 'slave_id')).toHaveLength(2);
  } finally { Object.values(gates).forEach(gate => gate.resolve()); await task.catch(() => {}); }
});

test.each(['unknown-response', 'wrong-master'])('a %s from one parallel stream rejects the complete snapshot', async invalid => {
  const { client } = rest(withoutFallbackHint([event(1, 4, 7, '2026-10-10T11:00:00Z')]));
  const from = client.from, signals = [];
  client.from = table => {
    const query = from(table), execute = query.abortSignal;
    query.abortSignal = async signal => {
      if (query.orders[0]?.[0] === 'slave_id') return execute(signal);
      signals.push(signal);
      if (query.filters.some(([method, key]) => method === 'eq' && key === 'upload_source'))
        return { data: invalid === 'unknown-response' ? {} : [event(2, 4, 99, '2026-10-10T11:00:00Z', undefined,
          { upload_source: 'phone', phone_received_at: '2026-10-10T11:00:00Z' })] };
      return execute(signal);
    };
    return query;
  };
  await expect(downloadCloudLatest({ client, masterIds: [7], cutoff: CUT })).rejects.toThrow();
  expect(signals).toHaveLength(2);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

function heldPipeline(events) {
  const f = rest(withoutFallbackHint(events)), from = f.client.from;
  const gates = new Map(), opened = new Set(), signals = [], dispatched = [];
  let releaseAll = false, active = 0, peak = 0, keys = 0, keyPeak = 0;
  f.client.from = table => {
    const query = from(table), execute = query.abortSignal;
    query.abortSignal = async signal => {
      const isKey = query.orders[0]?.[0] === 'slave_id';
      const slave = query.filters.find(([method, field]) => method === 'eq' && field === 'slave_id')?.[2];
      const after = query.filters.find(([method, field]) => method === 'gt' && field === 'slave_id')?.[2];
      const phone = query.filters.some(([method, field]) => method === 'eq' && field === 'upload_source');
      const fixed = query.filters.some(([method, field]) => method === 'gte' && field === 'payload->lat');
      const id = isKey ? `key:${after ?? 'start'}` : `dog:${slave}:${fixed ? 'fix' : 'packet'}:${phone ? 'phone' : 'fallback'}`;
      const gate = deferred(); gates.set(id, gate); signals.push(signal); dispatched.push(id);
      peak = Math.max(peak, ++active);
      if (isKey) keyPeak = Math.max(keyPeak, ++keys);
      try {
        if (!releaseAll && !opened.has(id)) await gate.promise;
        return await execute(signal);
      } finally { active--; if (isKey) keys--; }
    };
    return query;
  };
  return { ...f, dispatched, signals, peak: () => peak, keyPeak: () => keyPeak,
    open(id) { opened.add(id); gates.get(id)?.resolve(); },
    fail(id, error) { gates.get(id).reject(error); },
    close() { releaseAll = true; gates.forEach(gate => gate.resolve()); } };
}
const pipelineEvents = () => [event(1, 4, 7, '2026-10-08T11:00:00Z'),
  event(2, 4, 7, '2026-10-10T11:00:00Z', { lat: 0, lon: 0 }),
  event(3, 6, 7, '2026-10-10T11:00:00Z'), event(4, 8, 9, '2026-10-10T11:00:00Z'),
  event(5, 99, 10, '2026-10-10T11:00:00Z')];
async function startTwoJobs(f) {
  await microtasks(); f.open('key:start'); await microtasks();
  f.open('key:4'); await microtasks();
}

test('serial key discovery runs ahead of two bounded dog jobs, but returns all dogs only after their independent fixes complete', async () => {
  const f = heldPipeline(pipelineEvents());
  let settled = false;
  const task = downloadCloudLatest({ client: f.client, masterIds: [7, 9], cutoff: CUT });
  task.then(() => { settled = true; }, () => { settled = true; });
  try {
    await startTwoJobs(f);
    expect(f.dispatched).toEqual(['key:start', 'dog:4:packet:fallback', 'dog:4:packet:phone', 'key:4',
      'dog:6:packet:fallback', 'dog:6:packet:phone', 'key:6']);
    expect(f.peak()).toBe(5); expect(f.keyPeak()).toBe(1);
    f.open('key:6'); await microtasks();
    expect(f.dispatched.some(id => id.startsWith('dog:8:'))).toBe(false);
    expect(f.dispatched).toContain('key:8');
    f.open('key:8'); await microtasks();
    expect(settled).toBe(false);
    f.open('dog:4:packet:fallback'); f.open('dog:4:packet:phone'); await microtasks();
    expect(f.dispatched).toEqual(expect.arrayContaining(['dog:4:fix:fallback', 'dog:4:fix:phone']));
    expect(f.dispatched.some(id => id.startsWith('dog:8:'))).toBe(false);
    f.open('dog:6:packet:phone'); f.open('dog:6:packet:fallback'); await microtasks();
    expect(f.dispatched).toEqual(expect.arrayContaining(['dog:8:packet:fallback', 'dog:8:packet:phone', 'key:8']));
    f.open('dog:8:packet:fallback'); f.open('dog:8:packet:phone'); await microtasks();
    expect(settled).toBe(false);
    f.open('dog:4:fix:phone'); await microtasks(); expect(settled).toBe(false);
    f.open('dog:4:fix:fallback');
    const result = await task;
    expect(result.dogs.map(dog => dog.slaveId)).toEqual([4, 6, 8]);
    expect(result.dogs[0]).toMatchObject({ packet: { sequence: 2 }, fix: { sequence: 1 } });
    expect(f.dispatched.filter(id => id.startsWith('key:'))).toEqual(['key:start', 'key:4', 'key:6', 'key:8']);
    expect(f.peak()).toBeLessThanOrEqual(5); expect(f.keyPeak()).toBe(1);
  } finally { f.close(); await task.catch(() => {}); }
});

const queuedEvents = () => Array.from({ length: 10 }, (_, index) => event(index + 1, index + 1, 7,
  index < 2 ? '2026-10-08T11:00:00Z' : '2026-10-10T11:00:00Z'));
async function fillPrefetch(f) {
  await microtasks(); f.open('key:start'); await microtasks();
  for (let key = 1; key <= 5; key++) { f.open(`key:${key}`); await microtasks(); }
}
test('four prefetched keys bound discovery while two workers are held; freeing a worker resumes discovery and preserves the complete roster', async () => {
  const events = queuedEvents(), f = heldPipeline(events);
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT });
  task.catch(() => {});
  try {
    await fillPrefetch(f);
    expect(f.dispatched.filter(id => id.startsWith('key:'))).toEqual(['key:start', 'key:1', 'key:2', 'key:3', 'key:4', 'key:5']);
    expect(f.dispatched.filter(id => id.startsWith('dog:'))).toEqual([
      'dog:1:packet:fallback', 'dog:1:packet:phone', 'dog:2:packet:fallback', 'dog:2:packet:phone']);
    f.open('dog:1:packet:fallback'); f.open('dog:1:packet:phone'); await microtasks();
    expect(f.dispatched).toEqual(expect.arrayContaining(['dog:3:packet:fallback', 'dog:3:packet:phone', 'key:6']));
    f.open('key:6'); await microtasks();
    expect(f.dispatched).not.toContain('key:7');
    f.close();
    expect(await task).toEqual(await downloadCloudLatestSerial({ client: rest(events).client, masterIds: [7], cutoff: CUT }));
    expect(f.peak()).toBeLessThanOrEqual(5); expect(f.keyPeak()).toBe(1);
    expect(f.dispatched.filter(id => id.startsWith('key:'))).toHaveLength(11);
  } finally { f.close(); await task.catch(() => {}); }
});

test.each(['dog', 'owner', 'signal'])('a %s failure releases a full prefetch queue without dispatching queued dogs or accepting late results', async failure => {
  const f = heldPipeline(queuedEvents()), abort = new AbortController(); let current = true;
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT, signal: abort.signal,
    check: () => { if (!current) throw Error('invented revoked owner'); } });
  task.catch(() => {});
  try {
    await fillPrefetch(f);
    const before = [...f.dispatched];
    if (failure === 'dog') f.fail('dog:1:packet:phone', Error('invented packet failure'));
    else if (failure === 'owner') { current = false; f.open('dog:1:packet:phone'); }
    else abort.abort();
    await expect(task).rejects.toThrow();
    expect(f.signals.every(signal => signal.aborted)).toBe(true);
    f.close(); await microtasks();
    expect(f.dispatched).toEqual(before);
  } finally { f.close(); await task.catch(() => {}); }
});

test('a dog failure settles while prefetched discovery ignores abort, and its late key cannot launch a dog', async () => {
  const f = heldPipeline(queuedEvents());
  const task = downloadCloudLatest({ client: f.client, masterIds: [7], cutoff: CUT });
  task.catch(() => {});
  try {
    await microtasks(); f.open('key:start'); await microtasks(); f.open('key:1'); await microtasks();
    f.open('key:2'); await microtasks();
    expect(f.dispatched).toContain('key:3');
    const before = [...f.dispatched];
    f.fail('dog:2:packet:phone', Error('invented sibling failure'));
    // key:3 and the other dog transports are deliberately still unresolved.
    await expect(task).rejects.toThrow('invented sibling failure');
    expect(f.signals.every(signal => signal.aborted)).toBe(true);
    f.close(); await microtasks();
    expect(f.dispatched).toEqual(before);
  } finally { f.close(); await task.catch(() => {}); }
});

test.each(['key', 'dog', 'owner', 'signal'])('a %s failure cancels the entire discovery pipeline, including late sibling results', async failure => {
  const f = heldPipeline(pipelineEvents()), abort = new AbortController(); let current = true;
  const task = downloadCloudLatest({ client: f.client, masterIds: [7, 9], cutoff: CUT, signal: abort.signal,
    check: () => { if (!current) throw Error('invented old owner'); } });
  task.catch(() => {});
  try {
    await startTwoJobs(f);
    expect(f.dispatched).toContain('key:6');
    if (failure === 'key') f.fail('key:6', Error('invented key failure'));
    else if (failure === 'dog') f.fail('dog:6:packet:phone', Error('invented dog failure'));
    else if (failure === 'owner') { current = false; f.open('key:6'); }
    else { abort.abort(); f.open('key:6'); }
    await expect(task).rejects.toThrow();
    expect(f.signals.every(signal => signal.aborted)).toBe(true);
    f.close(); await microtasks();
    expect(f.dispatched.some(id => id.startsWith('dog:8:'))).toBe(false);
    expect(f.dispatched).not.toContain('key:8');
  } finally { f.close(); await task.catch(() => {}); }
});

test('the pipelined snapshot exactly matches the independent committed serial oracle across clocks, gaps and silent discovered dogs', async () => {
  // Independent invented regular samples, not translated real telemetry.
  const many = Array.from({ length: 18 }, (_, index) => {
    const slave = index * 3 + 1, seq = index * 3 + 10;
    return [event(seq, slave, index % 2 ? 9 : 7, '2026-10-08T09:00:00Z'),
      event(seq + 1, slave, 7, '2026-10-10T11:00:00Z', index % 3 ? { lat: 0, lon: 0 } : undefined),
      event(seq + 2, slave, 9, '2026-10-10T11:59:00Z', undefined,
        { upload_source: 'phone', phone_received_at: '2026-10-08T08:00:00Z' })];
  }).flat();
  const tied = [event(8, 4, 7, '2026-10-10T11:00:00.123450Z', undefined, { upload_source: 'wifi' }),
    event(9, 4, 9, '2026-10-10T11:00:00.123450Z', undefined,
      { upload_source: 'phone', phone_received_at: '2026-10-10T19:00:00.123451+08:00' })];
  for (const events of [[], pipelineEvents(), tied, many]) {
    const expected = await downloadCloudLatestSerial({ client: rest(events).client, masterIds: [7, 9], cutoff: CUT });
    expect(await downloadCloudLatest({ client: rest(events).client, masterIds: [7, 9], cutoff: CUT })).toEqual(expected);
  }
});

// Audit F4: the roster used to be every slave_id ever stored, and each old
// collar cost 2-5 requests every 30 s for good.
test('the roster only lists dogs with a row in the last ROSTER_WINDOW_MS; a listed dog still gets its older last fix', async () => {
  const ago = ms => new Date(CUT - ms).toISOString();
  const DAY = 24 * 60 * 60000;
  expect(ROSTER_WINDOW_MS).toBe(14 * DAY);
  const rows = [
    event(1, 4, 7, ago(15 * DAY)),
    // No GPS for 20 days, but packets this morning: on the roster, at its old fix.
    event(2, 6, 7, ago(20 * DAY)), event(3, 6, 7, ago(60 * 60000), { lat: 0, lon: 0 }),
    event(4, 8, 9, ago(ROSTER_WINDOW_MS - 1000)),
  ];
  const { client } = rest(rows);
  const result = await downloadCloudLatest({ client, masterIds: [7, 9], cutoff: CUT });
  expect(result.dogs.map(dog => dog.slaveId)).toEqual([6, 8]);
  expect(result.dogs[0]).toMatchObject({ packet: { sequence: 3 }, fix: { sequence: 2 } });
});

test('old collars on the roster no longer add requests to every latest download', async () => {
  const recent = [event(1, 4, 7, '2026-10-10T11:00:00Z'), event(2, 6, 7, '2026-10-10T11:30:00Z')];
  const old = Array.from({ length: 30 }, (_, index) =>
    event(100 + index, 50 + index, 7, new Date(CUT - (15 + index) * 24 * 60 * 60000).toISOString()));
  const without = rest(recent);
  await downloadCloudLatest({ client: without.client, masterIds: [7], cutoff: CUT });
  const withOld = rest([...recent, ...old]);
  const result = await downloadCloudLatest({ client: withOld.client, masterIds: [7], cutoff: CUT });
  expect(result.dogs.map(dog => dog.slaveId)).toEqual([4, 6]);
  expect(withOld.calls).toHaveLength(without.calls.length);
});
