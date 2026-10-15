import { createHoldStore, HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';

// Audit F6: the live map hands HoldStore every snapshot's whole half-hour
// context again on each 30 s download (useCloudDogs). A silent dog's newest
// row, equal to the tracker's lastTime, used to pass the dedupe and be
// appended again every time; the window is measured from that same newest
// row, so the copies were never trimmed, and every later row scanned them.
// Invented positions and clocks.
const NOW = Date.parse('2026-10-10T12:00:00Z');
const row = (index, extra = {}) => ({ slave_id: 6, master_id: 7, source: 'cloud', time: NOW - (1800 - index) * 1000,
  latitude: 24.9 + index * 1e-6, longitude: 121.3, satellites: 9, hdop: 1, event_id: `e${index}`, ...extra });
const context = Array.from({ length: 1800 }, (_, index) => row(index));
const seeds = Array.from({ length: 40 }, (_, index) => row(-4000 - index * 60, { event_id: `s${index}` }));
const judged = store => JSON.stringify({ holds: store.holds(NOW), statuses: store.statuses(),
  ranges: store.ranges(), batteries: store.batteries(), sizes: store.sizes() });

test('the same snapshot context fed again and again changes nothing (probe B6)', () => {
  const store = createHoldStore();
  store.ingest({ rows: context, seeds });
  const first = judged(store);
  expect(store.sizes()[6]).toEqual({ rows: 1800, seeds: 40, keys: 1800 });
  // Five hours of 30 s downloads.
  for (let revision = 0; revision < 600; revision++) store.ingest({ rows: context, seeds });
  expect(judged(store)).toBe(first);
});

test('the silent dog\'s newest row re-sent 20,000 times is not appended (probe B6b)', () => {
  const store = createHoldStore();
  const rows = Array.from({ length: 100 }, (_, index) => row(1700 + index));
  store.ingest({ rows });
  const first = judged(store);
  for (let i = 0; i < 20000; i++) store.ingest({ rows: [rows.at(-1)] });
  expect(store.sizes()[6]).toEqual({ rows: 100, seeds: 0, keys: 100 });
  expect(judged(store)).toBe(first);
});

test('the phone\'s own upload coming back from the cloud is the same packet, whatever its source and event', () => {
  const ble = { ...row(1799), source: 'ble', event_id: undefined, rssi: -70, master_latitude: 24.9, master_longitude: 121.3 };
  const store = createHoldStore();
  store.ingest({ rows: [...context.slice(0, 1799), ble] });
  const first = judged(store);
  store.ingest({ rows: [{ ...ble, source: 'cloud', event_id: 'cloud-copy', rssi: null }] });
  expect(judged(store)).toBe(first);
  expect(store.statuses()[6].bleRssi).toBe(-70);
});

test('new rows after the re-sends are still fed, and late ones still replay', () => {
  const store = createHoldStore();
  store.ingest({ rows: context.slice(0, 1700) });
  for (let i = 0; i < 50; i++) store.ingest({ rows: context.slice(0, 1700) });
  // A late row inside the window, then newer ones, in one batch.
  store.ingest({ rows: [row(1650.5, { event_id: 'late' }), ...context.slice(1700)] });
  const fresh = createHoldStore();
  fresh.ingest({ rows: [...context.slice(0, 1700), row(1650.5, { event_id: 'late' }), ...context.slice(1700)] });
  expect(store.sizes()[6]).toEqual(fresh.sizes()[6]);
  expect(store.statuses()[6].newestAt).toBe(fresh.statuses()[6].newestAt);
  expect(store.statuses()[6].lastGoodAt).toBe(fresh.statuses()[6].lastGoodAt);
});

test('six hours of a live dog at one row a second: the window, seeds and remembered keys stay bounded', () => {
  const store = createHoldStore();
  const start = NOW - 6 * 3600000;
  let peak = { rows: 0, seeds: 0, keys: 0 };
  for (let batch = 0; batch < 6 * 360; batch++) {
    const rows = Array.from({ length: 10 }, (_, index) => {
      const second = batch * 10 + index;
      return { slave_id: 6, master_id: 7, source: 'ble', time: start + second * 1000,
        latitude: 24.9 + (second % 600) * 2e-5, longitude: 121.3, satellites: 9, hdop: 1 };
    });
    store.ingest({ rows });
    // Every third batch, the same rows come back once more (the cloud copy).
    if (batch % 3 === 0) store.ingest({ rows: rows.map(value => ({ ...value, source: 'cloud' })) });
    const size = store.sizes()[6];
    peak = { rows: Math.max(peak.rows, size.rows), seeds: Math.max(peak.seeds, size.seeds), keys: Math.max(peak.keys, size.keys) };
  }
  const window = HOLD_LOOKBACK_MS / 1000;
  expect(peak.rows).toBeLessThanOrEqual(window + 10);
  expect(peak.seeds).toBeLessThanOrEqual(200);
  // An hour behind the newest row, plus one batch.
  expect(peak.keys).toBeLessThanOrEqual(2 * window + 20);
});
