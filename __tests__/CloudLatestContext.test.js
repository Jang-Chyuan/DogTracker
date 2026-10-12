import { downloadCloudLatestContext } from '../src/cloud/CloudLatest';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
const CUT = Date.parse('2026-10-10T12:00:00Z');
const event = (id, time, extra = {}) => ({ event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  master_id: 7, slave_id: 4, received_at: time, payload: { lat: 25000000, lon: 121000000, satellites: 6, hdop: 100 }, ...extra });
const snapshot = packet => ({ cutoff: CUT, dogs: [{ slaveId: 4, packet: mapCloudTelemetry(packet), fix: mapCloudTelemetry(packet) }] });
function sdk(pages) {
  const { createClient } = require('@supabase/supabase-js');
  const urls = [];
  const client = createClient('https://example.invalid', 'public-fixture-key', { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  }, global: { fetch: async url => {
    urls.push(new URL(url));
    if (!pages.length) throw new Error('unexpected request');
    return { ok: true, status: 200, statusText: 'OK', headers: new Map(), text: async () => JSON.stringify(pages.shift()) };
  } } });
  return { client, urls };
}

test('real SDK seeks all 501 same-millisecond context events, preserves six-digit cursors and separates old seeds', async () => {
  const recent = Array.from({ length: 501 }, (_, index) => event(index + 1,
    `2026-10-10T11:59:00.${String(123000 + index).padStart(6, '0')}Z`));
  // 500 phone rows fill a page, so the phone stream must seek a second one.
  const phones = Array.from({ length: 500 }, (_, index) => event(2000 + index, '2026-10-10T11:58:30Z',
    { upload_source: 'phone', phone_received_at: `2026-10-10T19:58:00.${String(100000 + index).padStart(6, '0')}+08:00` }));
  const phone = event(700, '2026-10-10T11:59:30Z', { upload_source: 'phone', phone_received_at: '2026-10-10T19:59:00.123501+08:00' });
  const old = event(900, '2026-10-09T11:00:00Z');
  // A short page ends a stream: no terminal empty page after recent[500] or [phone].
  const { client, urls } = sdk([recent.slice(0, 500), recent.slice(500), [old], phones, [phone], []]);
  const value = await downloadCloudLatestContext({ client, masterIds: [7], snapshot: snapshot(phone) });
  expect(urls).toHaveLength(6);
  expect(value.dogs[0].context).toHaveLength(1002);
  expect(new Set(value.dogs[0].context.map(row => row.event_id)).size).toBe(1002);
  expect(value.dogs[0].seeds.map(row => row.event_id)).toEqual([old.event_id]);
  const second = urls[1].searchParams;
  expect(second.get('or')).toContain(recent[499].received_at);
  expect(second.get('or')).toContain(recent[499].event_id);
  expect(second.get('or')).toContain('upload_source.neq.phone');
  expect(second.get('order')).toBe('received_at.asc,event_id.asc');
  const last = phones[499];
  expect(urls[4].searchParams.get('or')).toContain(last.phone_received_at);
  expect(urls[4].searchParams.get('or')).toContain(`phone_received_at.eq.${last.phone_received_at},received_at.eq.${last.received_at},event_id.gt.${last.event_id}`);
  expect(urls[2].searchParams.get('limit')).toBe('40');
  expect(urls[2].searchParams.get('payload->satellites')).toBe('gte.5');
  expect(urls[5].searchParams.get('limit')).toBe('40');
  expect(urls.every(url => url.searchParams.getAll('received_at').some(filter => filter === 'lt.2026-10-10T12:00:00.000Z'))).toBe(true);
});

test('a typical dog context needs one request per clock stream plus its two seeds', async () => {
  // Before: each non-empty stream also asked for an empty page (6 requests).
  const recent = Array.from({ length: 120 }, (_, index) => event(index + 1,
    new Date(Date.parse('2026-10-10T11:40:00Z') + index * 5000).toISOString()));
  const phone = event(700, '2026-10-10T11:59:30Z', { upload_source: 'phone', phone_received_at: '2026-10-10T19:59:00.123501+08:00' });
  const { client, urls } = sdk([recent, [], [phone], []]);
  const value = await downloadCloudLatestContext({ client, masterIds: [7], snapshot: snapshot(phone) });
  expect(urls).toHaveLength(4);
  expect(urls.map(url => url.searchParams.get('limit'))).toEqual(['500', '40', '500', '40']);
  expect(value.dogs[0].context).toHaveLength(121);
});

test('silent dogs replay their own last half hour rather than an empty wall-clock window', async () => {
  const last = event(1, '2026-10-09T11:00:00Z');
  const { client, urls } = sdk([[last], [], [], []]);
  const value = await downloadCloudLatestContext({ client, masterIds: [7], snapshot: snapshot(last) });
  expect(urls).toHaveLength(4);
  expect(value.dogs[0].context.map(row => row.event_id)).toEqual([last.event_id]);
  expect(urls[0].searchParams.getAll('received_at')).toContain('gte.2026-10-09T10:30:00.001Z');
});

test('repeated context seek, wrong dog, canceled or malformed response never returns partial context', async () => {
  const last = event(1, '2026-10-10T11:59:00Z');
  const full = Array.from({ length: 500 }, (_, index) => event(index + 1,
    `2026-10-10T11:58:00.${String(100000 + index).padStart(6, '0')}Z`));
  for (const pages of [[full, [full[499]]], [[{ ...last, slave_id: 6 }]], [full, null], [[last], null]]) {
    const { client } = sdk(pages);
    await expect(downloadCloudLatestContext({ client, masterIds: [7], snapshot: snapshot(last) })).rejects.toThrow();
  }
  const { client } = sdk([[last]]); const abort = new AbortController();
  await expect(downloadCloudLatestContext({ client, masterIds: [7], snapshot: snapshot(last), signal: abort.signal,
    check: () => { abort.abort(); } })).rejects.toThrow();
});
