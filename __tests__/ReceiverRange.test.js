import { t as i18nT } from '../src/i18n';
import {
  advanceRange, circleCoordinates, distanceMeters, emptyRange, judgeRange, RANGE, RANGE_STATUS,
  rangeLabel, rangeView, ringEdgePoint,
} from '../src/tracking/ReceiverRange';
import { createHoldStore } from '../src/placement/HoldStore';
import { outOfRangeLines, receiverRangeRing } from '../src/map/TrackingMapPresentation';
import { size } from '../src/theme/tokens';

// The receiver sits here; a dog `metres` due north of it.
const RECEIVER = { latitude: 24.99, longitude: 121.3 };
const north = (metres, from = RECEIVER) => ({
  latitude: from.latitude + metres / 111195,
  longitude: from.longitude,
});
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const T0 = Date.parse('2026-10-07T01:00:00Z');

// A BLE row: the dog `metres` from the receiver, `at` ms after T0.
const ble = (at, metres, extra = {}) => {
  const dog = north(metres, extra.receiver ?? RECEIVER);
  const receiver = extra.receiver ?? RECEIVER;
  return { time: T0 + at, source: 'ble', latitude: dog.latitude, longitude: dog.longitude,
    receiverLatitude: receiver.latitude, receiverLongitude: receiver.longitude, held: false, ...extra };
};
const cloud = (at, metres) => {
  const dog = north(metres);
  return { time: T0 + at, source: 'cloud', latitude: dog.latitude, longitude: dog.longitude };
};
const statusAfter = rows => judgeRange(rows).status;

describe('first judgement and thresholds (800 m / 1 km)', () => {
  test('nothing judged yet', () => {
    expect(emptyRange().status).toBeNull();
    expect(rangeView(emptyRange())).toBeNull();
  });
  test.each([
    [0, 'in'], [799, 'in'], [800, 'in'], [801, 'near'], [1000, 'near'], [1001, 'out'], [5000, 'out'],
  ])('%i m → %s', (metres, status) => {
    expect(statusAfter([ble(0, metres)])).toBe(status);
  });
  test('the constants are the design numbers and the ring token', () => {
    expect(RANGE).toMatchObject({ radiusM: 1000, nearM: 800, clearM: 900, clearFixes: 2, clearSpanMs: 120000,
      nearClearFixes: 2 });
    expect(size.rangeRing.radiusM).toBe(RANGE.radiusM);
  });
});

describe('in range → near → out', () => {
  test('beyond 800 m turns amber, beyond 1 km out, at the position that crossed', () => {
    let state = judgeRange([ble(0, 500)]);
    expect(state.status).toBe('in');
    state = advanceRange(state, ble(10 * SECOND, 850));
    expect(state.status).toBe('near');
    state = advanceRange(state, ble(20 * SECOND, 1100));
    expect(state).toMatchObject({ status: 'out', outSince: T0 + 20 * SECOND, judgedAt: T0 + 20 * SECOND });
  });
  test('straight from in range to out', () => {
    expect(statusAfter([ble(0, 500), ble(10 * SECOND, 1200)])).toBe('out');
  });
});

describe('near → in needs 2 positions in a row within 800 m', () => {
  test('one position back is not enough, two are', () => {
    let state = judgeRange([ble(0, 900)]);
    state = advanceRange(state, ble(10 * SECOND, 700));
    expect(state.status).toBe('near');
    state = advanceRange(state, ble(20 * SECOND, 650));
    expect(state.status).toBe('in');
  });
  test('a position back beyond 800 m in between starts the count again', () => {
    expect(statusAfter([ble(0, 900), ble(10 * SECOND, 700), ble(20 * SECOND, 820), ble(30 * SECOND, 700)]))
      .toBe('near');
  });
  test('near → out directly (first time out of range)', () => {
    const state = judgeRange([ble(0, 900), ble(10 * SECOND, 1050)]);
    expect(state).toMatchObject({ status: 'out', outSince: T0 + 10 * SECOND });
  });
});

describe('out clears only after ≥2 positions within 900 m spanning ≥2 minutes', () => {
  const out = () => judgeRange([ble(0, 1500)]);
  test('back to 950 m (inside the ring) is still out', () => {
    const state = [10, 20, 200, 400].reduce((current, seconds) =>
      advanceRange(current, ble(seconds * SECOND, 950)), out());
    expect(state.status).toBe('out');
    expect(state.clearing).toEqual([]);
  });
  test('two positions within 900 m but less than two minutes apart: still out', () => {
    const state = judgeRange([ble(0, 1500), ble(10 * SECOND, 600), ble(60 * SECOND, 600)]);
    expect(state.status).toBe('out');
    expect(state.clearing).toHaveLength(2);
  });
  test('two positions spanning two minutes clear it — to in range under 800 m', () => {
    const state = judgeRange([ble(0, 1500), ble(10 * SECOND, 600), ble(130 * SECOND, 600)]);
    expect(state).toMatchObject({ status: 'in', outSince: null, clearing: [] });
  });
  test('clearing at 800–900 m goes straight to amber 快離開', () => {
    expect(statusAfter([ble(0, 1500), ble(10 * SECOND, 850), ble(130 * SECOND, 880)])).toBe('near');
  });
  test('sparse data: one position only, however long ago, does not clear', () => {
    expect(statusAfter([ble(0, 1500), ble(10 * MINUTE, 300)])).toBe('out');
  });
  test('one position beyond 900 m in between starts the count again', () => {
    const state = judgeRange([ble(0, 1500), ble(10 * SECOND, 600), ble(70 * SECOND, 950),
      ble(130 * SECOND, 600), ble(200 * SECOND, 600)]);
    expect(state.status).toBe('out');
    expect(state.clearing).toEqual([T0 + 130 * SECOND, T0 + 200 * SECOND]);
    expect(advanceRange(state, ble(251 * SECOND, 600)).status).toBe('in');
  });
});

describe('the judgement is frozen without new positions of the dog', () => {
  test('a packet without a fix judges nothing', () => {
    const state = judgeRange([ble(0, 500), ble(10 * SECOND, 0, { latitude: 0, longitude: 0 })]);
    expect(state).toMatchObject({ status: 'in', judgedAt: T0, lastLocalAt: T0 + 10 * SECOND });
  });
  test('the receiver moving on its own changes nothing (only dog positions judge)', () => {
    // Judged in range at 780 m; the dog then sends no new position. Nothing
    // else can move the judgement, whatever the ring does afterwards.
    const state = judgeRange([ble(0, 780)]);
    expect(state.status).toBe('in');
    expect(rangeView(state)).toMatchObject({ status: 'in', problem: false });
  });
  test('a position judged against where the receiver was at that moment', () => {
    // Dog standing still 1.2 km north of the start; the receiver walks up to
    // it, so the same dog position is judged in range.
    const dog = north(1200);
    const at = (seconds, receiver) => ({ time: T0 + seconds * SECOND, source: 'ble', latitude: dog.latitude,
      longitude: dog.longitude, receiverLatitude: receiver.latitude, receiverLongitude: receiver.longitude });
    let state = judgeRange([at(0, RECEIVER)]);
    expect(state.status).toBe('out');
    state = advanceRange(state, at(10, north(700)));
    state = advanceRange(state, at(140, north(700)));
    expect(state.status).toBe('in');
  });
  test('without a receiver position nothing is judged', () => {
    const state = judgeRange([ble(0, 500), ble(10 * SECOND, 1500, { receiverLatitude: 0, receiverLongitude: 0 })]);
    expect(state.status).toBe('in');
  });
});

describe('held in place (indoor hold): no re-judging, no counting', () => {
  test('positions while held do not change the judgement', () => {
    const state = judgeRange([ble(0, 500), ble(10 * SECOND, 1500, { held: true })]);
    expect(state.status).toBe('in');
  });
  test('out before the hold stays out; held positions do not count towards clearing', () => {
    const state = judgeRange([ble(0, 1500), ble(10 * SECOND, 300, { held: true }),
      ble(200 * SECOND, 300, { held: true })]);
    expect(state.status).toBe('out');
    expect(state.clearing).toEqual([]);
  });
  test('counting starts again after the release, from the release', () => {
    const rows = [ble(0, 1500), ble(10 * SECOND, 300), ble(20 * SECOND, 300, { held: true }),
      ble(200 * SECOND, 300)];
    // The position before the hold does not combine with the one after.
    expect(statusAfter(rows)).toBe('out');
    expect(statusAfter([...rows, ble(330 * SECOND, 300)])).toBe('in');
  });
  test('the card: held hides the row (also amber), except out of range', () => {
    expect(rangeView(judgeRange([ble(0, 900)]), { held: true })).toBeNull();
    expect(rangeView(judgeRange([ble(0, 500)]), { held: true })).toBeNull();
    expect(rangeView(judgeRange([ble(0, 1500)]), { held: true }))
      .toMatchObject({ status: 'out', problem: true, showConfirmedAt: true, confirmedAt: T0 });
  });
});

describe('cloud data: never judges, never clears', () => {
  test('a cloud-only dog has no judgement', () => {
    const state = judgeRange([cloud(0, 1500), cloud(10 * SECOND, 300)]);
    expect(state.status).toBeNull();
    expect(rangeView(state)).toBeNull();
  });
  test('out, then only cloud positions: stays out, shows 最後確認', () => {
    const state = judgeRange([ble(0, 1500), cloud(4 * MINUTE, 300), cloud(10 * MINUTE, 300)]);
    expect(state).toMatchObject({ status: 'out', cloudOnly: true });
    expect(rangeView(state)).toMatchObject({ status: 'out', showConfirmedAt: true, confirmedAt: T0 });
  });
  test('after a switch to cloud, the count restarts once this phone hears the dog again', () => {
    const rows = [ble(0, 1500), ble(10 * SECOND, 600), cloud(5 * MINUTE, 600), ble(6 * MINUTE, 600)];
    // 10 s and 6 min are two positions within 900 m over two minutes, but the
    // switch to cloud in between voids the first.
    expect(statusAfter(rows)).toBe('out');
    expect(statusAfter([...rows, ble(8 * MINUTE + 1, 600)])).toBe('in');
  });
  test('BLE rows written late, from before the switch to cloud, do not clear', () => {
    let state = judgeRange([ble(0, 1500)]);
    state = advanceRange(state, cloud(10 * MINUTE, 300));
    state = advanceRange(state, ble(2 * MINUTE, 300));
    state = advanceRange(state, ble(4 * MINUTE, 300));
    expect(state).toMatchObject({ status: 'out', cloudOnly: true, clearing: [] });
    // Heard after the switch: counting starts there.
    state = advanceRange(state, ble(11 * MINUTE, 300));
    expect(state).toMatchObject({ status: 'out', cloudOnly: false, clearing: [T0 + 11 * MINUTE] });
  });
  test('a cloud row interleaved while this phone still hears the dog does not reset anything', () => {
    expect(statusAfter([ble(0, 1500), ble(10 * SECOND, 600), cloud(15 * SECOND, 600), ble(140 * SECOND, 600)]))
      .toBe('in');
  });
  test('in range, then only cloud data: the row disappears (cloud dog)', () => {
    const state = judgeRange([ble(0, 500), cloud(5 * MINUTE, 500)]);
    expect(state.status).toBe('in');
    expect(rangeView(state)).toBeNull();
    // Heard by this phone again: back.
    expect(rangeView(advanceRange(state, ble(6 * MINUTE, 500)))).toMatchObject({ status: 'in' });
  });
  test('the phone\'s own upload coming back from the cloud is not new data', () => {
    const state = judgeRange([ble(0, 1500), cloud(0, 1500)]);
    expect(state.cloudOnly).toBe(false);
  });
});

describe('order and duplicates', () => {
  test('a BLE row not newer than the last BLE row is ignored', () => {
    const state = judgeRange([ble(0, 500), ble(20 * SECOND, 900)]);
    expect(advanceRange(state, ble(10 * SECOND, 5000))).toBe(state);
    expect(advanceRange(state, ble(20 * SECOND, 5000))).toBe(state);
  });
  test('a BLE row written after a newer cloud row still judges', () => {
    let state = judgeRange([ble(0, 500)]);
    state = advanceRange(state, cloud(30 * SECOND, 500));
    state = advanceRange(state, ble(20 * SECOND, 1500));
    expect(state.status).toBe('out');
  });
  test('invalid time is ignored; the state is never mutated', () => {
    const state = judgeRange([ble(0, 500)]);
    expect(advanceRange(state, { ...ble(0, 1500), time: NaN })).toBe(state);
    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe('disconnected receiver', () => {
  test('the last judgement stays shown as it was (no new rows at all)', () => {
    expect(rangeView(judgeRange([ble(0, 900)]))).toMatchObject({ status: 'near', warning: true });
    expect(rangeView(judgeRange([ble(0, 1500)])))
      .toMatchObject({ status: 'out', problem: true, showConfirmedAt: false });
  });
});

describe('labels (copy deck)', () => {
  const clock = time => new Date(time).toISOString().slice(11, 16);
  test.each([
    [[ble(0, 300)], {}, '在範圍內'],
    [[ble(0, 900)], {}, '快離開接收範圍'],
    [[ble(0, 1500)], {}, '不在接收範圍'],
    [[ble(0, 1500)], { held: true }, '不在接收範圍・最後確認 01:00'],
  ])('%#', (rows, options, label) => {
    expect(rangeLabel(rangeView(judgeRange(rows), options), clock)).toBe(label);
  });
  test('no row, no words', () => {
    expect(rangeLabel(null)).toBeNull();
  });
});

describe('geometry', () => {
  test('distance', () => {
    expect(distanceMeters(RECEIVER, north(1000))).toBeCloseTo(1000, 0);
  });
  test('the ring edge point nearest the dog lies on the centre–dog line', () => {
    const dog = { latitude: RECEIVER.latitude + 0.009, longitude: RECEIVER.longitude + 0.012 };
    const edge = ringEdgePoint(RECEIVER, dog, 1000);
    expect(distanceMeters(RECEIVER, edge)).toBeCloseTo(1000, -1);
    expect(distanceMeters(RECEIVER, edge) + distanceMeters(edge, dog)).toBeCloseTo(distanceMeters(RECEIVER, dog), 0);
    expect(ringEdgePoint(RECEIVER, RECEIVER)).toBeNull();
  });
  test('the ring outline is 1 km all round', () => {
    const outline = circleCoordinates(RECEIVER, 1000);
    expect(outline.length).toBeGreaterThanOrEqual(64);
    for (const point of outline) expect(distanceMeters(RECEIVER, point)).toBeCloseTo(1000, -1);
  });
});

describe('ring and red dashed line on the map', () => {
  const position = { coordinate: RECEIVER };
  test('the ring needs a connected receiver with a position', () => {
    expect(receiverRangeRing(position, 'receiving')).toMatchObject({ center: RECEIVER, radiusMeters: 1000 });
    expect(receiverRangeRing(position, 'quiet')).not.toBeNull();
    for (const link of ['disconnected', 'connecting', 'stopped', 'none', undefined]) {
      expect(receiverRangeRing(position, link)).toBeNull();
    }
    expect(receiverRangeRing(null, 'receiving')).toBeNull();
  });
  const ring = receiverRangeRing(position, 'receiving');
  const dog = (slaveId, metres, extra = {}) => ({ slaveId, coordinate: north(metres), ...extra });
  const out = { status: RANGE_STATUS.OUT };
  test('out of range and drawn outside the ring: one line, edge → dog', () => {
    const lines = outOfRangeLines(ring, [dog(4, 1300)], { 4: out });
    expect(lines).toHaveLength(1);
    expect(distanceMeters(RECEIVER, lines[0].coordinates[0])).toBeCloseTo(1000, -1);
    expect(lines[0].coordinates[1]).toEqual(north(1300));
  });
  test('no line: no ring, not judged out, drawn inside the ring, or held in place', () => {
    expect(outOfRangeLines(null, [dog(4, 1300)], { 4: out })).toEqual([]);
    expect(outOfRangeLines(ring, [dog(4, 1300)], { 4: { status: 'in' } })).toEqual([]);
    expect(outOfRangeLines(ring, [dog(4, 1300)], {})).toEqual([]);
    expect(outOfRangeLines(ring, [dog(4, 950)], { 4: out })).toEqual([]);
    expect(outOfRangeLines(ring, [dog(4, 1300, { heldReason: i18nT('c114') })], { 4: out })).toEqual([]);
    expect(outOfRangeLines(ring, [dog(4, 1300, { coordinate: null })], { 4: out })).toEqual([]);
  });
});

describe('fed by the live hold store', () => {
  // holdRows-shaped rows of one dog, every 10 s, with the receiver position.
  const rows = (fromSeconds, toSeconds, metres, extra = {}) => {
    const result = [];
    for (let seconds = fromSeconds; seconds <= toSeconds; seconds += 10) {
      const dog = north(metres);
      result.push({ id: seconds, master_id: 7, slave_id: 4, latitude: dog.latitude, longitude: dog.longitude,
        satellites: 9, hdop: 0.9, rssi: -70, snr: 8, usb_present: 0, time: T0 + seconds * SECOND, source: 'ble',
        master_latitude: RECEIVER.latitude, master_longitude: RECEIVER.longitude, ...extra });
    }
    return result;
  };
  test('BLE rows judge, across polls', () => {
    const store = createHoldStore();
    store.ingest({ rows: rows(0, 60, 500) });
    expect(store.ranges()[4].status).toBe('in');
    store.ingest({ rows: rows(70, 120, 1300) });
    expect(store.ranges()[4].status).toBe('out');
  });
  test('cloud rows (no receiver position) never create a judgement', () => {
    const store = createHoldStore();
    store.ingest({ rows: rows(0, 60, 1500, { source: 'cloud', master_latitude: undefined,
      master_longitude: undefined }) });
    expect(store.ranges()).toEqual({});
  });
  test('a replacement store keeps the judgements of the one it replaces', () => {
    const first = createHoldStore();
    first.ingest({ rows: rows(0, 60, 1500) });
    const second = createHoldStore();
    second.seedRanges(first.ranges());
    // The replay of the same rows changes nothing; 950 m afterwards is still out.
    second.ingest({ rows: [...rows(0, 60, 1500), ...rows(70, 400, 950)] });
    expect(second.ranges()[4].status).toBe('out');
    // Without the carried state the replay window alone would say near.
    const fresh = createHoldStore();
    fresh.ingest({ rows: rows(70, 400, 950) });
    expect(fresh.ranges()[4].status).toBe('near');
  });
  test('a late cloud row replays the hold but does not move the range back', () => {
    const store = createHoldStore();
    store.ingest({ rows: rows(0, 60, 1500) });
    store.ingest({ rows: rows(10, 20, 300, { source: 'cloud', master_id: 9, id: undefined }) });
    expect(store.ranges()[4].status).toBe('out');
  });
});

test('K07: a range episode remains out after 25 hours without clearing evidence', () => {
  const store = createHoldStore();
  const point = ble(0, 1200);
  store.ingest({ rows: [{ ...point, slave_id: 4, master_id: 7, master_latitude: RECEIVER.latitude, master_longitude: RECEIVER.longitude }] });
  store.holds(T0 + 25 * 60 * MINUTE);
  expect(store.ranges()[4].status).toBe('out');
});
