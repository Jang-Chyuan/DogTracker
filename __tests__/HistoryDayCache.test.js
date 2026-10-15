// The few days the history screen keeps (audit M4/M6, 2026-10-15): bounded
// by days and rows, the exact model cache over them, the append-only rows
// of a poll, and the rule that lets the screen keep rows by reference
// instead of copying them: nothing in the history pipeline writes to a row.
import { createDayCache, HISTORY_KEPT_DAYS, HISTORY_KEPT_ROWS } from '../src/mapHistory/HistoryDayCache';
import { createExactHistoryModelCache, sameHistoryInput } from '../src/mapHistory/HistoryExactSnapshot';
import { withRows } from '../src/mapHistory/useHistoryScreen';
import { normalizeHistoryRows } from '../src/history/HistorySources';
import { dogHistoryRow, phoneHistoryRow } from '../src/history/HistoryRows';
import { multiDayModel, multiMapPresentation } from '../src/history/screen/HistoryMultiModel';
import { createHistoryHolds } from '../src/placement/IndoorHold';
import { sameSnapshot, takeSnapshot, valuePaths } from '../src/history/ValueSnapshot';

const DAY = new Date(2026, 9, 12).getTime();

describe('createDayCache', () => {
  const entry = (name, rows) => ({ name, rows });
  const cache = (options) => createDayCache({ rowsOf: e => e.rows, ...options });
  test('keeps the newest few days, newest first; find marks a day as used', () => {
    const kept = cache({ days: 3, rows: Infinity });
    for (const name of ['a', 'b', 'c', 'd']) kept.put(entry(name, 10));
    expect(kept.size).toBe(3);
    expect(kept.peek(e => e.name === 'a')).toBeNull();
    expect(kept.find(e => e.name === 'b').name).toBe('b');
    kept.put(entry('e', 10));
    // b was used after c: c goes first.
    expect(['b', 'c', 'd', 'e'].filter(name => kept.peek(e => e.name === name))).toEqual(['b', 'd', 'e']);
  });
  test('bounded by rows: long days keep the day shown and one more, the day shown always stays', () => {
    const kept = cache({ days: 3, rows: 30000 });
    kept.put(entry('a', 14000));
    kept.put(entry('b', 14000));
    kept.put(entry('c', 14000));
    expect(kept.size).toBe(2);
    expect(kept.peek(e => e.name === 'a')).toBeNull();
    kept.put(entry('huge', 80000));
    expect(kept.size).toBe(1);
    expect(kept.peek(e => e.name === 'huge')).not.toBeNull();
  });
  test('put replaces what `replaces` matches; remove and clear', () => {
    const kept = cache({ days: 3, rows: Infinity });
    kept.put(entry('a', 1)); kept.put(entry('b', 1));
    kept.put(entry('a', 2), e => e.name === 'a');
    expect(kept.size).toBe(2);
    expect(kept.peek(e => e.name === 'a').rows).toBe(2);
    kept.remove(e => e.name === 'b');
    expect(kept.size).toBe(1);
    kept.clear();
    expect(kept.size).toBe(0);
  });
  test('the screen keeps three ordinary days or two long ones', () => {
    expect(HISTORY_KEPT_DAYS).toBe(3);
    expect(3 * 8000).toBeLessThanOrEqual(HISTORY_KEPT_ROWS);
    expect(3 * 14000).toBeGreaterThan(HISTORY_KEPT_ROWS);
    expect(2 * 14000).toBeLessThanOrEqual(HISTORY_KEPT_ROWS);
  });
});

describe('createExactHistoryModelCache', () => {
  const subjects = rows => [{ id: 6, subject: 'dog', rows, replayHolds: undefined }];
  const options = day => ({ dayStart: day, dayEnd: day + 86400000, now: null, manual: null });
  test('another day kept: coming back to it with the same rows reuses its model', () => {
    const cache = createExactHistoryModelCache({ days: 3, rows: Infinity });
    const identity = ['a', 1];
    const rowsA = [{ time: 1 }], rowsB = [{ time: 2 }];
    const build = jest.fn(() => ({}));
    const a = cache(identity, subjects(rowsA), options(DAY), build);
    const b = cache(identity, subjects(rowsB), options(DAY + 86400000), build);
    expect(cache(identity, subjects(rowsA), options(DAY), build)).toBe(a);
    expect(cache(identity, subjects(rowsB), options(DAY + 86400000), build)).toBe(b);
    expect(build).toHaveBeenCalledTimes(2);
    // Equal rows that are not the very rows accepted: built again.
    expect(cache(identity, subjects([{ time: 1 }]), options(DAY), build)).not.toBe(a);
  });
  test('one model per day; another identity (account, publisher, opening) drops them all', () => {
    const cache = createExactHistoryModelCache({ days: 3, rows: Infinity });
    const rows = [{ time: 1 }], more = [{ time: 1 }, { time: 2 }];
    const build = () => ({});
    cache(['a'], subjects(rows), options(DAY), build);
    cache(['a'], subjects(more), options(DAY), build);
    expect(cache.size).toBe(1);
    cache(['a'], subjects(rows), options(DAY + 86400000), build);
    expect(cache.size).toBe(2);
    cache(['b'], subjects(rows), options(DAY), build);
    expect(cache.size).toBe(1);
  });
  test('bounded by the rows of the days kept', () => {
    const cache = createExactHistoryModelCache({ days: 3, rows: 30000 });
    const long = Array.from({ length: 14000 }, (_, i) => ({ time: i }));
    for (let d = 0; d < 3; d += 1) cache(['a'], subjects(long.slice()), options(DAY + d * 86400000), () => ({}));
    expect(cache.size).toBe(2);
  });
});

describe('withRows (a poll adds rows without sorting the day again)', () => {
  const sorted = (rows, added) => [...rows, ...added].sort((a, b) => a.time - b.time);
  const row = (time, tag) => ({ time, tag });
  test.each([
    ['appended', [row(1, 'a'), row(2, 'b')], [row(3, 'c'), row(4, 'd')]],
    ['between (a download)', [row(1, 'a'), row(5, 'b'), row(9, 'c')], [row(6, 'd'), row(2, 'e')]],
    ['ties keep the rows already read first', [row(1, 'a'), row(2, 'b'), row(2, 'c')], [row(2, 'd'), row(1, 'e')]],
    ['before all', [row(5, 'a')], [row(1, 'b'), row(1, 'c')]],
    ['first read', [], [row(3, 'a'), row(1, 'b')]],
    ['a row without a time falls back to the sort', [row(1, 'a'), row(3, 'b')], [row(null, 'c'), row(2, 'd')]],
  ])('%s: the same rows in the same order as a stable sort', (_label, rows, added) => {
    const out = withRows(rows, added);
    expect(out.map(r => r.tag)).toEqual(sorted(rows, added).map(r => r.tag));
    if (added.length) expect(out).not.toBe(rows);
  });
  test('nothing added: the very same array', () => {
    const rows = [row(1, 'a')];
    expect(withRows(rows, [])).toBe(rows);
  });
});

describe('sameHistoryInput on arrays', () => {
  test('index by index, holes apart from undefined', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(sameHistoryInput([1, , 3], [1, undefined, 3])).toBe(false);
    expect(sameHistoryInput([1, undefined, 3], [1, undefined, 3])).toBe(true);
    expect(sameHistoryInput([{ a: 1 }], [{ a: 1, b: undefined }])).toBe(false);
    expect(sameHistoryInput([1, 2], [1, 2, 3])).toBe(false);
  });
});

// ---- rows are never written ----------------------------------------------

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
};
// A dog's morning around a fictional place: a stay, a walk, a stay indoors
// (fixes without satellites, the hold pass moves them), and on again.
function dogRows() {
  const rows = [];
  for (let i = 0; i < 900; i += 1) {
    const time = DAY + 6 * 3600000 + i * 20000;
    const walking = i >= 200 && i < 400, indoors = i >= 500 && i < 650;
    const step = walking ? i - 200 : i >= 400 ? 200 : 0;
    rows.push(dogHistoryRow({ id: i + 1, received_at: time, master_id: 7, slave_id: 6,
      slave_lat: 24.9892 + step * 0.00002 + (i % 3) * 0.000002, slave_lon: 121.3138 + step * 0.00001,
      satellites: indoors ? 0 : 9, hdop: indoors ? 9 : 0.9, rssi: -70, snr: 6, gps_time: indoors ? null : Math.floor(time / 1000),
      speed_kmh: walking ? 4 : 0 }, 'local'));
  }
  return rows;
}
function phoneRows() {
  const rows = [];
  for (let i = 0; i < 900; i += 1) {
    const time = DAY + 6 * 3600000 + i * 10000;
    const walking = i >= 300 && i < 500;
    const step = walking ? i - 300 : i >= 500 ? 200 : 0;
    const lat = 24.9892 + step * 0.00003 + (i % 4) * 0.000003, lon = 121.3138 + step * 0.00001;
    rows.push(phoneHistoryRow({ id: i + 1, time, latitude: lat, longitude: lon, accuracy: walking ? 6 : 14,
      raw_latitude: lat, raw_longitude: lon, speed_kmh: walking ? 4.3 : 0, raw_speed_kmh: walking ? 4.3 : 0,
      speed_accuracy_mps: 0.5, motion_state: walking ? 'moving' : 'still', session_id: 's' }));
  }
  return rows;
}
const holdPass = () => {
  const holds = { pass: null };
  const replay = packets => {
    const done = holds.pass?.output ?? [];
    const same = !!holds.pass && done.length <= packets.length && done.every((o, i) => o.id === packets[i].id && o.time === packets[i].time);
    if (!same) holds.pass = createHistoryHolds({ seed: [] });
    holds.pass.append(packets.slice(same ? done.length : 0));
    return holds.pass.output;
  };
  replay.copiesPackets = true;
  return replay;
};
const shape = day => JSON.stringify({ range: day.range, main: { points: day.main.points.length, nodes: day.main.nodes.map(n => [n.type, n.start, n.end, n.latitude, n.longitude]), distanceM: day.main.distanceM } });

test.each(['dog', 'phone'])('%s: the model and the map read the day\'s rows without writing to them', subject => {
  const options = { dayStart: DAY, dayEnd: DAY + 86400000, today: false, now: DAY + 86400000, following: false, protagonist: subject === 'dog' ? 6 : 'phone' };
  const id = subject === 'dog' ? 6 : 'phone';
  const plain = subject === 'dog' ? dogRows() : phoneRows();
  const frozen = deepFreeze(subject === 'dog' ? dogRows() : phoneRows());
  const look = { [id]: { color: '#ff0000', avatar: null, name: 'x' } };
  const free = multiDayModel([{ id, subject, rows: plain, replayHolds: subject === 'dog' ? holdPass() : undefined }], options);
  let held;
  // Strict-mode modules throw on any write to a frozen row.
  expect(() => {
    held = multiDayModel([{ id, subject, rows: frozen, replayHolds: subject === 'dog' ? holdPass() : undefined }], options);
    multiMapPresentation(held, {}, look, undefined, null);
  }).not.toThrow();
  expect(shape(held)).toEqual(shape(free));
  if (subject === 'dog') expect(held.main.nodes.some(n => n.type === 'indoor')).toBe(true);
  // The packets the model keeps are the rows themselves, not copies.
  expect(held.main.packets[0]).toBe(frozen[0]);
});

test('normalizeHistoryRows keeps a row already in its common form, copies any other', () => {
  const [dog] = dogRows(), [phone] = phoneRows();
  const raw = { id: 1, received_at: DAY, slave_lat: 24.9, slave_lon: 121.3, source: 'local' };
  expect(normalizeHistoryRows([dog])[0]).toBe(dog);
  expect(normalizeHistoryRows([phone])[0]).toBe(phone);
  const copied = normalizeHistoryRows([raw])[0];
  expect(copied).not.toBe(raw);
  expect(copied).toMatchObject({ time: DAY, packetTime: DAY, locationTime: DAY, latitude: 24.9, longitude: 121.3, source: 'local' });
  // Another source asked for: a copy with it.
  expect(normalizeHistoryRows([dog], 'cloud')[0]).not.toBe(dog);
});

test('the map drawing\'s packed snapshot notices a fix the hold pass moved in place, as === did', () => {
  const paths = valuePaths([[null, 'time'], [null, 'latitude'], [null, 'heldReason'], [null, 'stationary'], ['to', 'latitude'], [null, 'extra']]);
  const shared = {};
  const points = [
    { time: 1, latitude: 24.9, heldReason: undefined, stationary: true, to: { latitude: 1 }, extra: shared },
    { time: 2, latitude: 24.91, heldReason: null, stationary: false, to: { latitude: 2 }, extra: 'a' },
  ];
  const snapshot = takeSnapshot(points, paths);
  expect(sameSnapshot(snapshot, points, paths)).toBe(true);
  expect(sameSnapshot(snapshot, points.slice(0, 1), paths)).toBe(false);
  expect(sameSnapshot(snapshot, points, valuePaths([[null, 'time']]))).toBe(false);
  const moved = points.map(p => ({ ...p, to: { ...p.to } }));
  moved[1].latitude = 24.9; moved[1].heldReason = 'indoor';
  expect(sameSnapshot(snapshot, moved, paths)).toBe(false);
  for (const [key, value] of [['heldReason', undefined], ['heldReason', 'indoor'], ['stationary', 0], ['extra', {}], ['extra', 'b']]) {
    const changed = points.map(p => ({ ...p }));
    changed[key === 'heldReason' ? 1 : 0][key] = value;
    expect(sameSnapshot(snapshot, changed, paths)).toBe(false);
  }
  const nested = points.map(p => ({ ...p, to: { latitude: p.to.latitude + 1 } }));
  expect(sameSnapshot(snapshot, nested, paths)).toBe(false);
  // === as before: 0 and -0 match, NaN never does.
  const zero = valuePaths([[null, 'v']]);
  expect(sameSnapshot(takeSnapshot([{ v: 0 }], zero), [{ v: -0 }], zero)).toBe(true);
  expect(sameSnapshot(takeSnapshot([{ v: NaN }], zero), [{ v: NaN }], zero)).toBe(false);
});
