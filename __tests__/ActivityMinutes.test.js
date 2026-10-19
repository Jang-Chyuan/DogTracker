import { t as i18nT } from '../src/i18n';
import {
  ACTIVITY, activityMinutes, activityReadings, activityState, activityWords, durationText, readingKey,
  REST_MAX_MISSING_MINUTES,
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

// 2026-10-19: a minute without a packet between readings at most 3 minutes
// apart carries the previous value (fillActivityGaps); 休息 needs all 10.
test('rest: minutes without a packet between close readings are filled; a gap over 3 minutes is not', () => {
  const gaps = time => {
    const minute = Math.ceil((NOW - time) / MINUTE);
    return [3, 7].includes(minute) ? null : 0.01;
  };
  const rows = [];
  for (let time = at(30); time < NOW; time += 10000) rows.push({ time, activity: gaps(time), slave_id: 4 });
  const minutes = activityMinutes(activityReadings(rows, 'ble'), { now: NOW });
  expect(activityState(minutes, { end: lastFinished }).state).toBe('rest');
  // Missing every third minute: each one is filled, so it is a rest.
  const sparse = activityMinutes(readings(30, 0, 0.01).filter(item =>
    Math.ceil((NOW - item.time) / MINUTE) % 3 !== 0), { now: NOW });
  expect(activityState(sparse, { end: lastFinished }).state).toBe('rest');
  // Three minutes in a row without a packet (a 4-minute gap): not filled,
  // 7 of 10 minutes, neither rest nor normal.
  const holed = activityMinutes([...readings(30, 5, 0.01), ...readings(2, 0, 0.01)], { now: NOW });
  expect(activityState(holed, { end: lastFinished })).toEqual({ state: null, since: null, durationMinutes: null });
  // Two in a row (a 3-minute gap) are filled.
  const two = activityMinutes([...readings(30, 4, 0.01), ...readings(2, 0, 0.01)], { now: NOW });
  expect(activityState(two, { end: lastFinished })).toMatchObject({ state: 'rest', since: at(30) });
  // Judged at a minute before the next packet, the minutes since the last
  // one are not filled yet (a later reading is not used): 8 of 10, 一般.
  expect(activityState(two, { end: at(3) }).state).toBe('normal');
  expect(activityState(two, { end: at(2) })).toMatchObject({ state: 'rest', since: at(30) });
});

// 2026-10-13: going back, a rest is broken only by an active minute. Windows
// that merely lack data (lost packets, fewer than 8 of 10 minutes) carry it on,
// so 「已 N 分鐘」 does not restart after a few silent minutes.
test('rest: minutes without data do not restart the run; an active minute does', () => {
  // Calm 40–26 and 22–0 minutes ago, nothing at all in between (4 minutes).
  const holed = activityMinutes([...readings(40, 26, 0.02), ...readings(22, 0, 0.02)], { now: NOW });
  expect(activityState(holed, { end: lastFinished })).toEqual({ state: 'rest', since: at(40), durationMinutes: 40 });
  // A longer silence (15 minutes, no window with 8 of 10 in it) does not end it either.
  const silent = activityMinutes([...readings(40, 30, 0.02), ...readings(15, 0, 0.02)], { now: NOW });
  expect(activityState(silent, { end: lastFinished })).toMatchObject({ state: 'rest', since: at(40) });
  // Sparse data before the rest (every third minute missing) is still calm.
  const sparse = activityMinutes([...readings(40, 12, 0.02).filter(item =>
    Math.ceil((NOW - item.time) / MINUTE) % 3 !== 0), ...readings(12, 0, 0.02)], { now: NOW });
  expect(activityState(sparse, { end: lastFinished }).since).toBe(at(40));
  // One active minute ends it: the run starts at the first minute with data
  // after it, even when the minutes right after it have none.
  const active = activityMinutes([...readings(40, 25, 0.02), ...readings(25, 24, 0.3),
    ...readings(20, 0, 0.02)], { now: NOW });
  expect(activityState(active, { end: lastFinished })).toEqual({ state: 'rest', since: at(20), durationMinutes: 20 });
  // Now still needs 8 of the last 10 minutes.
  const stale = activityMinutes([...readings(40, 5, 0.02)], { now: NOW });
  expect(activityState(stale, { end: lastFinished }).state).toBeNull();
  // Vigorous: a gap over 3 minutes still breaks it.
  const vigorous = activityMinutes([...readings(20, 5, 0.9), ...readings(2, 0, 0.9)], { now: NOW });
  expect(activityState(vigorous, { end: lastFinished })).toMatchObject({ state: 'vigorous', since: at(2) });
});

// 2026-10-13 (#137): more than REST_MAX_MISSING_MINUTES (30) in a row without
// any data (collar off, out of range) does end the rest; 30 or fewer do not.
test('rest: a stretch without data longer than 30 minutes ends the run', () => {
  expect(REST_MAX_MISSING_MINUTES).toBe(30);
  expect(ACTIVITY.restMaxMissingMinutes).toBe(REST_MAX_MISSING_MINUTES);
  // Calm 90–61 minutes ago, nothing for 31 minutes (60..30 ago), calm since.
  const long = activityMinutes([...readings(90, 61, 0.02), ...readings(30, 0, 0.02)], { now: NOW });
  expect(activityState(long, { end: lastFinished })).toEqual({ state: 'rest', since: at(30), durationMinutes: 30 });
  // Exactly 30 minutes without data (60..31 ago): carried across.
  const thirty = activityMinutes([...readings(90, 60, 0.02), ...readings(30, 0, 0.02)], { now: NOW });
  expect(activityState(thirty, { end: lastFinished })).toEqual({ state: 'rest', since: at(90), durationMinutes: 90 });
  // Two shorter silences add up to more than 30 but each is carried across.
  const twice = activityMinutes([...readings(90, 70, 0.02), ...readings(50, 40, 0.02), ...readings(20, 0, 0.02)],
    { now: NOW });
  expect(activityState(twice, { end: lastFinished }).since).toBe(at(90));
  // The cap is configurable (config.restMaxMissingMinutes).
  expect(activityState(thirty, { end: lastFinished, config: { ...ACTIVITY, restMaxMissingMinutes: 10 } }).since)
    .toBe(at(30));
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
  // A minute without a packet between two vigorous readings is filled and
  // bridges them (2026-10-19); three in a row break it: the run restarts
  // after the hole.
  const gap = activityMinutes([...readings(20, 3, 0.9), ...readings(2, 0, 0.9)], { now: NOW });
  expect(activityState(gap, { end: lastFinished })).toMatchObject({ state: 'vigorous', since: at(20) });
  const hole = activityMinutes([...readings(20, 5, 0.9), ...readings(2, 0, 0.9)], { now: NOW });
  expect(activityState(hole, { end: lastFinished })).toMatchObject({ state: 'vigorous', since: at(2) });
  expect(activityState(hole, { end: at(6) }).state).toBe('vigorous');
  // One vigorous reading and the minute filled after it are not a pair.
  const once = activityMinutes([...readings(20, 3, 0.3), ...readings(3, 2, 0.9), ...readings(1, 0, 0.3)],
    { now: NOW });
  expect(activityState(once, { end: lastFinished }).state).toBe('normal');
  expect(activityState(once, { end: at(3) }).state).toBe('normal');
});

test('no data, or judged where nothing was read: 「—」', () => {
  expect(activityState([], { end: lastFinished }).state).toBeNull();
  const old = activityMinutes(readings(60, 30, 0.02), { now: NOW });
  expect(activityState(old, { end: lastFinished }).state).toBeNull();
  // Judged at the time the readings stopped, they still say rest.
  expect(activityState(old, { end: at(31) })).toMatchObject({ state: 'rest', durationMinutes: 30 });
});

test('the card words, and durations past an hour', () => {
  // TalkBack says the minutes are the collar's motion (活動量), not 室內.
  expect(activityWords({ state: 'rest', durationMinutes: 18 })).toEqual({ word: i18nT('c069'), detail: '已 18 分鐘',
    speechDetail: '活動量低已 18 分鐘', tone: 'rest' });
  expect(activityWords({ state: 'vigorous', durationMinutes: 3 })).toEqual({ word: i18nT('c350'), detail: '已 3 分鐘',
    speechDetail: '活動量高已 3 分鐘', tone: 'vigorous' });
  expect(activityWords({ state: 'normal' })).toEqual({ word: i18nT("c434"), detail: null, tone: 'normal' });
  expect(activityWords(null)).toEqual({ word: '—', detail: null, tone: null });
  expect(durationText(59)).toBe('59 分鐘');
  expect(durationText(60)).toBe('1 小時');
  expect(durationText(340)).toBe('5 小時 40 分');
});

// 2026-10-15 (emulator): a rest as long as the card's six-hour lookback read
// 「已 5 小時 58 分」「已 5 小時 59 分」「已 6 小時」 by turns as the lookback slid.
describe('a rest reaching back to where the readings begin', () => {
  const SIX = 6 * 60;
  const from = minutesAgo => at(minutesAgo);
  test('nothing read ends it: over the lookback, 「超過 6 小時」', () => {
    for (const [start, edge] of [[0, 0], [10, 0], [25, 20]]) {
      // Readings from `start` seconds after the lookback edge (`edge` minutes
      // of nothing before the first), calm all along.
      const minutes = activityMinutes(readings(SIX - edge, 0, 0.02).filter(item => item.time >= from(SIX) + start * 1000),
        { now: NOW });
      const result = activityState(minutes, { end: lastFinished, from: from(SIX) });
      if (edge < ACTIVITY.restMinutes) {
        expect(result).toMatchObject({ state: 'rest', over: true });
        const words = activityWords(result, { lookbackMinutes: SIX });
        expect(words).toEqual({ word: i18nT('c069'), detail: '超過 6 小時', speechDetail: '活動量低超過 6 小時', tone: 'rest' });
      } else {
        // The first reading is more than a rest window in: the run may have
        // started there, it counts from there.
        expect(result.over).toBeUndefined();
        expect(activityWords(result, { lookbackMinutes: SIX }).detail).toBe(`已 ${durationText(SIX - edge)}`);
      }
    }
  });

  test('a rest begun inside the lookback counts its minutes, even close to the edge', () => {
    const minutes = activityMinutes([...readings(SIX, SIX - 3, 0.4), ...readings(SIX - 3, 0, 0.02)], { now: NOW });
    const result = activityState(minutes, { end: lastFinished, from: from(SIX) });
    expect(result).toEqual({ state: 'rest', since: at(SIX - 3), durationMinutes: SIX - 3 });
    expect(activityWords(result, { lookbackMinutes: SIX }).detail).toBe('已 5 小時 57 分');
  });

  test('without the lookback edge the minutes are counted as before', () => {
    const minutes = activityMinutes(readings(SIX, 0, 0.02), { now: NOW });
    expect(activityState(minutes, { end: lastFinished }).over).toBeUndefined();
    expect(activityWords(activityState(minutes, { end: lastFinished, from: from(SIX) })).detail)
      .toBe(`已 ${durationText(SIX)}`);
  });
});
