import {
  ACTIVITY, activityMinutes, activityReadings, activityState, activityWords, durationText, readingKey,
} from '../src/activity/ActivityMinutes';

const MINUTE = 60000;
// 09:30:00 local on a fixed day; minutes are counted back from here.
const NOW = new Date(2026, 9, 7, 9, 30, 0).getTime();
const at = (minutesAgo, seconds = 0) => NOW - minutesAgo * MINUTE + seconds * 1000;

// One reading every 10 s over [fromAgo, toAgo) minutes ago.
function readings(fromAgo, toAgo, value, source = 'ble', slave = 4) {
  const rows = [];
  for (let time = at(fromAgo); time < at(toAgo); time += 10000) {
    rows.push({ time, activity: typeof value === 'function' ? value(time) : value, activity_valid: 1,
      slave_id: slave, master_id: 7 });
  }
  return activityReadings(rows, source);
}
const lastFinished = NOW - MINUTE;

test('readings: invalid, out-of-range and flagged rows are dropped; text values are numbers', () => {
  const rows = [
    { time: 1, activity: '0.4', activity_valid: 1, slave_id: 4 },
    { time: 2, activity: 0.5, activity_valid: 0, slave_id: 4 },
    { time: 3, activity: 1.4, activity_valid: 1, slave_id: 4 },
    { time: 4, activity: null, activity_valid: 1, slave_id: 4 },
    { time: null, activity: 0.2, activity_valid: 1, slave_id: 4 },
  ];
  expect(activityReadings(rows, 'ble')).toEqual([{ time: 1, value: 0.4, key: '4|t1', source: 'ble' }]);
});

test('minutes: whole-minute buckets, the mean of each, the running minute left out', () => {
  const values = [
    ...activityReadings([{ time: at(2, 5), activity: 0.2, slave_id: 4 },
      { time: at(2, 55), activity: 0.4, slave_id: 4 }], 'ble'),
    ...activityReadings([{ time: at(1, 30), activity: 0.9, slave_id: 4 }], 'ble'),
    // In now's minute: not finished, not judged.
    ...activityReadings([{ time: NOW + 20000, activity: 1, slave_id: 4 }], 'ble'),
  ];
  const minutes = activityMinutes(values, { now: NOW + 30000 });
  expect(minutes.map(item => item.minute)).toEqual([at(2), at(1)]);
  expect(minutes[0].value).toBeCloseTo(0.3);
  expect(minutes[0].count).toBe(2);
  expect(minutes[1].value).toBeCloseTo(0.9);
});

test('minutes: the cloud copy of a reading counts once, and the local copy wins', () => {
  const local = activityReadings([{ time: at(3, 10), activity: 0.1, slave_id: 4, master_id: 7, activity_time: '777' }], 'ble');
  // Downloaded back with another time (the server's) but the same collar stamp.
  const cloud = activityReadings([
    { time: at(4, 50), activity: 0.1, slave_id: 4, master_id: 7, activity_time: '777' },
    // This phone's own upload: same time to the millisecond, no stamp.
    { time: at(3, 20), activity: 0.5, slave_id: 4 },
  ], 'cloud');
  const ownCopy = activityReadings([{ time: at(3, 20), activity: 0.5, slave_id: 4 }], 'ble');
  const minutes = activityMinutes([...cloud, ...local, ...ownCopy], { now: NOW });
  expect(minutes).toEqual([{ minute: at(3), value: 0.3, count: 2 }]);
  expect(readingKey({ slave_id: 4, master_id: 7, activity_time: 777 }, 5)).toBe('4|a777|m7');
  expect(readingKey({ slave_id: 4 }, 5)).toBe('4|t5');
});

test('rest: 10 calm minutes; it lasts from the first one', () => {
  const minutes = activityMinutes([...readings(40, 18, 0.3), ...readings(18, 0, 0.02)], { now: NOW });
  expect(activityState(minutes, { end: lastFinished })).toEqual({ state: 'rest', since: at(18), durationMinutes: 18 });
  // Nine calm minutes are not yet a rest.
  const short = activityMinutes([...readings(40, 9, 0.3), ...readings(9, 0, 0.02)], { now: NOW });
  expect(activityState(short, { end: lastFinished }).state).toBe('normal');
});

test('rest tolerates a missing minute here and there (8 of 10), not three', () => {
  const gaps = time => {
    const minute = Math.ceil((NOW - time) / MINUTE);
    return [3, 7].includes(minute) ? null : 0.01;
  };
  const rows = [];
  for (let time = at(30); time < NOW; time += 10000) rows.push({ time, activity: gaps(time), slave_id: 4 });
  const minutes = activityMinutes(activityReadings(rows, 'ble'), { now: NOW });
  expect(activityState(minutes, { end: lastFinished }).state).toBe('rest');
  // Missing every third minute: never 8 of 10, so neither rest nor normal.
  const sparse = activityMinutes(readings(30, 0, 0.01).filter(item =>
    Math.ceil((NOW - item.time) / MINUTE) % 3 !== 0), { now: NOW });
  expect(activityState(sparse, { end: lastFinished })).toEqual({ state: null, since: null, durationMinutes: null });
});

test('rest ends at the first minute that is not calm', () => {
  const minutes = activityMinutes([...readings(30, 1, 0.02), ...readings(1, 0, 0.3)], { now: NOW });
  expect(activityState(minutes, { end: lastFinished }).state).toBe('normal');
  // The threshold itself is calm (at most 0.05).
  const edge = activityMinutes(readings(20, 0, ACTIVITY.restMax), { now: NOW });
  expect(activityState(edge, { end: lastFinished }).state).toBe('rest');
});

test('vigorous: both of the last 2 minutes at 0.8 or more, both with data', () => {
  const minutes = activityMinutes([...readings(20, 3, 0.3), ...readings(3, 0, 0.85)], { now: NOW });
  expect(activityState(minutes, { end: lastFinished })).toEqual({ state: 'vigorous', since: at(3), durationMinutes: 3 });
  // One vigorous minute is not enough.
  const one = activityMinutes([...readings(20, 1, 0.3), ...readings(1, 0, 0.95)], { now: NOW });
  expect(activityState(one, { end: lastFinished }).state).toBe('normal');
  // A missing minute breaks it (both minutes need data): the run restarts
  // after the hole.
  const gap = activityMinutes([...readings(20, 3, 0.9), ...readings(2, 0, 0.9)], { now: NOW });
  expect(activityState(gap, { end: lastFinished })).toMatchObject({ state: 'vigorous', since: at(2) });
  const hole = activityMinutes([...readings(20, 2, 0.9), ...readings(1, 0, 0.9)], { now: NOW });
  expect(activityState(hole, { end: at(1) }).state).toBe('normal');
  expect(activityState(hole, { end: at(3) }).state).toBe('vigorous');
});

test('no data, or judged where nothing was read: 「—」', () => {
  expect(activityState([], { end: lastFinished }).state).toBeNull();
  const old = activityMinutes(readings(60, 30, 0.02), { now: NOW });
  expect(activityState(old, { end: lastFinished }).state).toBeNull();
  // Judged at the time the readings stopped, they still say rest.
  expect(activityState(old, { end: at(31) })).toMatchObject({ state: 'rest', durationMinutes: 30 });
});

test('the card words, and durations past an hour', () => {
  expect(activityWords({ state: 'rest', durationMinutes: 18 })).toEqual({ word: '休息中', detail: '已 18 分鐘', tone: 'rest' });
  expect(activityWords({ state: 'vigorous', durationMinutes: 3 })).toEqual({ word: '劇烈活動', detail: '已 3 分鐘', tone: 'vigorous' });
  expect(activityWords({ state: 'normal' })).toEqual({ word: '一般', detail: null, tone: 'normal' });
  expect(activityWords(null)).toEqual({ word: '—', detail: null, tone: null });
  expect(durationText(59)).toBe('59 分鐘');
  expect(durationText(60)).toBe('1 小時');
  expect(durationText(340)).toBe('5 小時 40 分');
});
