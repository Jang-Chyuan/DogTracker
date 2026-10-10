import { downloadCloudLatest } from '../src/cloud/CloudLatest';

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
        if (method === 'gte') return typeof prop === 'number' && prop >= value;
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
          const left = key.endsWith('_at') ? Date.parse(a[key]) : a[key];
          const right = key.endsWith('_at') ? Date.parse(b[key]) : b[key];
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
    event(3, 4, 7, '2026-10-10T11:00:00Z', { lat: 0, lon: 0 })]);
  const result = await downloadCloudLatest({ client, masterIds: [7], cutoff: CUT });
  expect(result.dogs[0].fix.sequence).toBe(1);
  const malformed = rest([event(9, 4, 7, '2026-10-10T11:00:00Z', { lat: '25', lon: 121000000 })]);
  await expect(downloadCloudLatest({ client: malformed.client, masterIds: [7], cutoff: CUT })).rejects.toThrow();
});

test('empty membership yields a complete empty snapshot and canceled requests cannot return a snapshot', async () => {
  const { client } = rest([]);
  expect(await downloadCloudLatest({ client, masterIds: [], cutoff: CUT })).toEqual({ cutoff: CUT, dogs: [] });
  expect(client.from).not.toHaveBeenCalled();
  await expect(downloadCloudLatest({ client, masterIds: [7], cutoff: CUT,
    signal: { aborted: true } })).rejects.toThrow();
});
