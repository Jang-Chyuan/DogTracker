// F5 (2026-10-15): this phone, the server and other phones each have their
// own clock. The server's offset comes from the HTTP Date header; downloaded
// rows are moved onto this phone's clock where they meet BLE rows.
import {
  cloudRowOnPhoneClock, cloudRowsOnPhoneClock, createServerClock, FUTURE_TOLERANCE_MS, serverClockFetch,
  SKEW_TOLERANCE_MS, SUSPECT_AHEAD_MS,
} from '../src/cloud/ServerClock';
import { downloadCloudLatest } from '../src/cloud/CloudLatest';
import { cloudEvent, latestArchiveRest } from '../__fixtures__/LatestArchiveRest';
import { dogFreshness } from '../src/tracking/DogFreshness';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { createHoldStore } from '../src/placement/HoldStore';
import { RANGE_STATUS } from '../src/tracking/ReceiverRange';
import { alertLine } from '../src/alerts/AlertContent';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const MINUTE = 60000;
const header = time => new Date(time).toUTCString();
const quiet = { info: () => {} };

describe('the server clock', () => {
  test('estimates the offset from the Date header; a healthy clock is left alone', () => {
    const clock = createServerClock({ log: quiet });
    expect(clock.offset()).toBe(0);
    expect(clock.estimate()).toBeNull();
    // 20 s off: within the tolerance, nothing moves.
    clock.observe(header(NOW + 20000), NOW - 100, NOW + 100);
    expect(clock.estimate()).toBeCloseTo(20500, -3);
    expect(clock.offset()).toBe(0);
    // Four minutes ahead (whole seconds; applied in 5 s steps).
    const ahead = createServerClock({ log: quiet });
    for (let index = 0; index < 3; index++) ahead.observe(header(NOW + 4 * MINUTE + index * 1000), NOW + index * 1000, NOW + index * 1000 + 300);
    expect(ahead.offset()).toBe(4 * MINUTE);
    // A phone behind: negative.
    const behind = createServerClock({ log: quiet });
    behind.observe(header(NOW - 15 * MINUTE), NOW, NOW + 200);
    expect(behind.offset()).toBe(-15 * MINUTE);
  });

  test('ignores slow responses and junk, and does not flap at the tolerance', () => {
    const clock = createServerClock({ log: quiet });
    clock.observe(header(NOW + 10 * MINUTE), NOW, NOW + 20000);
    clock.observe('not a date', NOW, NOW + 100);
    clock.observe(header(NOW), NOW + 100, NOW);
    expect(clock.estimate()).toBeNull();
    clock.observe(header(NOW + SKEW_TOLERANCE_MS + 3000), NOW, NOW);
    const applied = clock.offset();
    expect(applied).toBeGreaterThan(SKEW_TOLERANCE_MS);
    // Just back inside the tolerance: kept (hysteresis) ...
    for (let index = 0; index < 7; index++) clock.observe(header(NOW + SKEW_TOLERANCE_MS - 2000), NOW, NOW);
    expect(clock.offset()).toBeGreaterThanOrEqual(applied - 5000);
    // ... clearly inside: off.
    for (let index = 0; index < 7; index++) clock.observe(header(NOW + 1000), NOW, NOW);
    expect(clock.offset()).toBe(0);
  });

  test('the fetch wrapper reads the Date header and passes the response through', async () => {
    const clock = createServerClock({ log: quiet });
    let time = NOW;
    const response = { status: 200, headers: { get: name => (name === 'date' ? header(NOW + 5 * MINUTE) : null) } };
    const fetch = serverClockFetch(async () => { time += 200; return response; }, clock, () => time);
    expect(await fetch('https://example.invalid')).toBe(response);
    expect(clock.offset()).toBe(5 * MINUTE);
    // No header, a throwing header reader, a failed request: untouched.
    const odd = serverClockFetch(async () => ({ headers: { get: () => { throw new Error('x'); } } }), clock);
    await expect(odd('u')).resolves.toBeTruthy();
    const failing = serverClockFetch(async () => { throw new TypeError('Network request failed'); }, clock);
    await expect(failing('u')).rejects.toThrow('Network request failed');
  });
});

describe('downloaded rows on this phone\'s clock', () => {
  const wifi = { slave_id: 6, master_id: 7, source: 'cloud', received_at: NOW, track_at: NOW, slave_lat: 24.9, slave_lon: 121.3 };
  const relayed = { ...wifi, upload_source: 'phone', phone_received_at: NOW - 3000, track_at: NOW - 3000 };

  test('a Wi-Fi row moves by the offset; a relayed row keeps its phone time unless it is in the future', () => {
    expect(cloudRowOnPhoneClock(wifi, 0)).toBe(wifi);
    expect(cloudRowOnPhoneClock(wifi, 4 * MINUTE).track_at).toBe(NOW - 4 * MINUTE);
    // This phone's own upload comes back with its BLE time, whatever the server says.
    const own = { ...relayed, received_at: NOW + 4 * MINUTE };
    expect(cloudRowOnPhoneClock(own, 4 * MINUTE)).toBe(own);
    // A teammate's clock 15 minutes ahead: the server's arrival stands in.
    const ahead = { ...relayed, phone_received_at: NOW + 15 * MINUTE, track_at: NOW + 15 * MINUTE };
    expect(cloudRowOnPhoneClock(ahead, 0).track_at).toBe(NOW);
    expect(cloudRowOnPhoneClock({ ...ahead, phone_received_at: NOW + FUTURE_TOLERANCE_MS }, 0).track_at).toBe(NOW + FUTURE_TOLERANCE_MS);
    const ble = { ...wifi, source: 'ble' };
    expect(cloudRowOnPhoneClock(ble, 4 * MINUTE)).toBe(ble);
    const rows = [wifi, relayed];
    expect(cloudRowsOnPhoneClock(rows, 0)).toBe(rows);
    expect(cloudRowsOnPhoneClock(rows, MINUTE * 2)[0].track_at).toBe(NOW - 2 * MINUTE);
  });

  // Audit probe B4a: an uploader 15 minutes ahead.
  test('a teammate 15 minutes ahead neither stays fresh in silence nor beats a newer BLE fix', () => {
    const skewed = { slave_id: 6, master_id: 7, slave_lat: 24.9, slave_lon: 121.3, received_at: NOW,
      upload_source: 'phone', phone_received_at: NOW + 15 * MINUTE, track_at: NOW + 15 * MINUTE };
    const cloudRows = cloudRowsOnPhoneClock([skewed], 0);
    const [heard] = mergeDogMarkers({
      point: { slaveId: 6, masterId: 3, slaveLat: 24.95, slaveLon: 121.31, receivedAt: NOW + 5 * MINUTE },
      cloudRows, now: NOW + 5 * MINUTE });
    expect(heard).toMatchObject({ fixSource: 'ble', fixAt: NOW + 5 * MINUTE });
    const [silent] = mergeDogMarkers({ cloudRows, now: NOW + 24 * MINUTE });
    expect(dogFreshness(silent, { now: NOW + 24 * MINUTE }).stale).toBe(true);
    expect(dogFreshness(silent, { now: NOW + 5 * MINUTE }).stale).toBe(false);
    // Uncorrected (no offset known), the future time itself is not believed.
    const future = { slaveId: 6, coordinate: { latitude: 24.9, longitude: 121.3 }, fixAt: NOW + 15 * MINUTE, fixSource: 'cloud' };
    expect(dogFreshness(future, { now: NOW + 24 * MINUTE - 15 * MINUTE })).toMatchObject({ stale: true, suspect: true,
      ageMs: null });
    expect(dogFreshness({ ...future, fixAt: NOW + SUSPECT_AHEAD_MS }, { now: NOW }).stale).toBe(false);
    expect(dogFreshness({ ...future, fixAt: NOW + SUSPECT_AHEAD_MS + 1 }, { now: NOW }).suspect).toBe(true);
    // The same for this phone's own rows (its clock set back since).
    expect(dogFreshness({ ...future, fixSource: 'ble' }, { now: NOW }).stale).toBe(true);
    expect(alertLine({ kind: 'dog-stale', name: '豆豆', basis: 'position', ageMs: null })).toBe('豆豆：沒有新位置');
  });

  // Audit probe B4b: the server clock more than 3 minutes ahead of this phone.
  test('a server 4 minutes ahead no longer stops the range judging this phone\'s own packets', () => {
    const receiver = { master_latitude: 24.9, master_longitude: 121.3 };
    const ble = (time, latitude) => ({ slave_id: 6, master_id: 3, source: 'ble', time, latitude, longitude: 121.3,
      satellites: 9, hdop: 1, ...receiver });
    // A Wi-Fi copy of the 1-minute packet, stamped by a server 4 minutes ahead.
    const wifiCopy = { slave_id: 6, master_id: 3, received_at: NOW + 5 * MINUTE, track_at: NOW + 5 * MINUTE,
      slave_lat: 24.9, slave_lon: 121.3, satellites: 9, hdop: 1 };
    // useCloudDogs feeds the hold/range trackers like this.
    const normalize = (row, offset) => ({ ...row, source: 'cloud', time: cloudRowOnPhoneClock(row, offset).track_at,
      latitude: row.slave_lat, longitude: row.slave_lon });
    const judge = offset => {
      const store = createHoldStore();
      store.ingest({ rows: [ble(NOW, 24.9)] });
      store.ingest({ rows: [normalize(wifiCopy, offset)] });
      // The dog runs 1.5 km away; this phone hears it (its own clock).
      for (let minute = 2; minute <= 4; minute++) store.ingest({ rows: [ble(NOW + minute * MINUTE, 24.9135)] });
      return store.ranges()[6];
    };
    expect(judge(0)).toMatchObject({ status: RANGE_STATUS.IN, cloudOnly: true });
    expect(judge(4 * MINUTE)).toMatchObject({ status: RANGE_STATUS.OUT, cloudOnly: false });
  });

  test('a phone behind the server still downloads the newest Wi-Fi rows', async () => {
    // This phone's clock is 4 minutes behind: its "now" is the server's NOW + 4 min.
    const events = [cloudEvent(1, NOW - 10 * MINUTE), cloudEvent(2, NOW + 2 * MINUTE, { latitude: 24.99 })];
    const network = latestArchiveRest({ events });
    const old = await downloadCloudLatest({ client: network.client, masterIds: [7], cutoff: NOW });
    expect(old.dogs[0].fix.received_at).toBe(NOW - 10 * MINUTE);
    const fixed = await downloadCloudLatest({ client: network.client, masterIds: [7], cutoff: NOW, serverOffset: 4 * MINUTE });
    expect(fixed).toMatchObject({ cutoff: NOW, serverCutoff: NOW + 4 * MINUTE });
    expect(fixed.dogs[0].fix.received_at).toBe(NOW + 2 * MINUTE);
    // On this phone's clock it is two minutes old, as it really is.
    expect(cloudRowOnPhoneClock(fixed.dogs[0].fix, 4 * MINUTE).track_at).toBe(NOW - 2 * MINUTE);
  });
});
