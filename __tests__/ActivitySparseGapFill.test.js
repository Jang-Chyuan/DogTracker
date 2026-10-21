import { activityMinutes, activityReadings, activityState } from '../src/activity/ActivityMinutes';
import { mergeMinutes } from '../src/activity/ActivityData';
import { buildDayView, buildWeekView } from '../src/activity/views';

// 2026-10-19: collars send sparsely to save battery (50–80 packets an hour,
// gaps of 30–110 s, now and then a few minutes). A minute without a packet
// between two readings at most 4 minutes apart carries the previous reading's
// value; only longer gaps are 沒有資料 (the user's decision, first 3 minutes,
// then 4 after replaying a real day). Fictional data only.
const M = 60000;
const S = 1000;
const date = (month, day, hour = 0, minute = 0, second = 0) =>
  new Date(2026, month - 1, day, hour, minute, second).getTime();
const DAY = date(10, 1);
const LATER = date(10, 8, 12);
const options = { date: DAY, now: LATER, earliest: date(9, 1) };
// The gaps a battery-saving collar leaves between packets (seconds).
const GAPS = [30, 110, 45, 90, 100, 35, 110, 60, 75, 30];

// Rows every GAPS[i] seconds from `from` while before `until`.
function sparse(from, until, activity, extra = {}) {
  const rows = [];
  for (let time = from, i = 0; time < until; time += GAPS[i % GAPS.length] * S, i += 1) {
    rows.push({ time, activity, activity_valid: 1, slave_id: 4, master_id: 7, ...extra });
  }
  return rows;
}
const readingsOf = rows => activityReadings(rows, 'ble');
const states = (view, from, to) => {
  const tally = {};
  for (const point of view.points) {
    if (point.minute < from || point.minute >= to) continue;
    tally[point.state] = (tally[point.state] || 0) + 1;
  }
  return tally;
};
// What readActivityPeriod's 'minute' detail answers (per-minute SQL sums).
function sqlMinutes(rows) {
  const byMinute = new Map();
  for (const row of rows) {
    const minute = Math.floor(row.time / M) * M;
    const old = byMinute.get(minute) || { minute, sum: 0, count: 0, charging: 0 };
    if (row.usb_present === 1) old.charging = 1;
    else {
      old.sum += row.activity;
      old.count += 1;
    }
    byMinute.set(minute, old);
  }
  return mergeMinutes([...byMinute.values()], []);
}

// 08:00–08:20 一般 (0.3), 08:20–08:40 rest-level (0.02), one 0.3 at 08:40:05.
const walkThenRest = () => [
  ...sparse(date(10, 1, 8, 0, 5), date(10, 1, 8, 20), 0.3),
  ...sparse(date(10, 1, 8, 20, 5), date(10, 1, 8, 40), 0.02),
  { time: date(10, 1, 8, 40, 5), activity: 0.3, activity_valid: 1, slave_id: 4, master_id: 7 },
];

test('sparse packets: no 沒有資料 between them, and a rest forms', () => {
  const rows = walkThenRest();
  // The sequence really is sparse: some minutes have no packet of their own.
  const own = new Set(rows.map(row => Math.floor(row.time / M)));
  expect(own.size).toBeLessThan(41);
  const view = buildDayView({ ...options, readings: readingsOf(rows) });
  expect(states(view, date(10, 1, 8, 0), date(10, 1, 8, 41))).toEqual({ normal: 21, rest: 20 });
  expect(view.bands.rest).toEqual([{ start: date(10, 1, 8, 20), end: date(10, 1, 8, 40) }]);
  // The card, judged at the last rest-level reading's minute, says 休息.
  const last = rows.filter(row => row.activity === 0.02).pop().time;
  const end = Math.floor(last / M) * M;
  const minutes = activityMinutes(readingsOf(rows), { now: end + M });
  expect(activityState(minutes, { end })).toEqual({ state: 'rest', since: date(10, 1, 8, 20),
    durationMinutes: (end + M - date(10, 1, 8, 20)) / M });
});

test('a gap of 5 minutes stays 沒有資料; one of 4 minutes is filled', () => {
  const at = (hour, minute, activity = 0.3) => ({ time: date(10, 1, hour, minute, 10), activity,
    activity_valid: 1, slave_id: 4, master_id: 7 });
  const rows = [at(10, 0), at(10, 5), at(11, 0), at(11, 4)];
  const view = buildDayView({ ...options, readings: readingsOf(rows) });
  expect(states(view, date(10, 1, 10, 0), date(10, 1, 10, 6))).toEqual({ normal: 2, missing: 4 });
  expect(states(view, date(10, 1, 11, 0), date(10, 1, 11, 5))).toEqual({ normal: 5 });
  // A filled minute carries the previous reading's value and has no packet.
  const filled = view.points.find(point => point.minute === date(10, 1, 11, 1));
  expect(filled).toMatchObject({ value: 0.3, count: 0, state: 'normal' });
  // A rest with a hole over 4 minutes in it: the hole is 沒有資料 and splits it.
  const calm = [...sparse(date(10, 1, 12, 0, 5), date(10, 1, 12, 15, 30), 0.02),
    at(12, 21, 0.02), ...sparse(date(10, 1, 12, 21, 40), date(10, 1, 12, 37), 0.02)];
  const holed = buildDayView({ ...options, readings: readingsOf(calm) });
  const hole = states(holed, date(10, 1, 12, 0), date(10, 1, 12, 37));
  expect(hole.missing).toBeGreaterThanOrEqual(4);
  expect(holed.bands.rest.length).toBe(2);
});

test('charging → unplugged: never filled across, charging stays charging', () => {
  const rows = [
    // On the charger 14:00–14:20 (valid 0, usb_present 1), sparse too.
    ...sparse(date(10, 1, 14, 0, 5), date(10, 1, 14, 19, 50), 0, { usb_present: 1 }),
    // Off the charger: calm, sparse, from 14:21:30.
    ...sparse(date(10, 1, 14, 21, 30), date(10, 1, 14, 40), 0.02, { usb_present: 0 }),
  ];
  const lastCharging = Math.floor(rows.filter(row => row.usb_present === 1).pop().time / M) * M;
  const view = buildDayView({ ...options, readings: readingsOf(rows) });
  const tally = states(view, date(10, 1, 14, 0), date(10, 1, 14, 40));
  // Every minute on the charger is 充電中 (the gaps between charging packets too).
  expect(tally.charging).toBe((lastCharging - date(10, 1, 14, 0)) / M + 1);
  // The minutes between the last charging packet and the first calm one are
  // not filled from either side.
  const between = view.points.filter(point => point.minute > lastCharging && point.minute < date(10, 1, 14, 21));
  expect(between.length).toBeGreaterThan(0);
  expect(between.every(point => point.state === 'missing')).toBe(true);
  // The rest starts after the charger came off.
  const lastCalm = Math.floor(rows[rows.length - 1].time / M) * M;
  expect(view.bands.rest).toEqual([{ start: date(10, 1, 14, 21), end: lastCalm + M }]);
  expect(tally.rest).toBe((lastCalm - date(10, 1, 14, 21)) / M + 1);
  const minutes = activityMinutes(readingsOf(rows), { now: lastCalm + M });
  expect(activityState(minutes, { end: lastCalm })).toMatchObject({ state: 'rest',
    since: date(10, 1, 14, 21) });
});

test('week from per-minute aggregates fills the same way as the day', () => {
  const rows = walkThenRest();
  const day = buildDayView({ ...options, readings: readingsOf(rows) });
  const week = buildWeekView({ ...options, minutes: sqlMinutes(rows) });
  const bar = week.bars.find(item => item.start === DAY);
  expect(bar.totals).toEqual(day.totals);
  expect(bar.totals).toMatchObject({ rest: 20, normal: 21 });
  // The day built from the same aggregates (as the year's months are) agrees too.
  expect(buildDayView({ ...options, minutes: sqlMinutes(rows) }).totals).toEqual(day.totals);
});

test('the card agrees with the day view at every minute with a packet', () => {
  const rows = walkThenRest();
  const readings = readingsOf(rows);
  const own = [...new Set(rows.map(row => Math.floor(row.time / M) * M))].sort((a, b) => a - b);
  for (const end of own.slice(10)) {
    const card = activityState(activityMinutes(readings, { now: end + M }), { end }).state;
    const day = buildDayView({ ...options, now: end + M, readings }).points.find(point => point.minute === end);
    expect([end, card]).toEqual([end, day.state]);
  }
});

test('vigorous: a filled minute never makes a pair on its own', () => {
  const at = (hour, minute, activity) => ({ time: date(10, 1, hour, minute, 10), activity,
    activity_valid: 1, slave_id: 4, master_id: 7 });
  // Two real readings ≥ 0.8 two minutes apart: the minute between is bridged.
  const bridged = [at(16, 0, 0.9), at(16, 2, 0.9), at(16, 4, 0.3)];
  const view = buildDayView({ ...options, readings: readingsOf(bridged) });
  expect(view.points.slice(16 * 60, 16 * 60 + 5).map(point => point.state))
    .toEqual(['vigorous', 'vigorous', 'vigorous', 'normal', 'normal']);
  const minutes = activityMinutes(readingsOf(bridged), { now: date(10, 1, 16, 3) });
  expect(activityState(minutes, { end: date(10, 1, 16, 2) })).toMatchObject({ state: 'vigorous',
    since: date(10, 1, 16, 0) });
  // One real reading ≥ 0.8 and its filled copy: not 劇烈.
  const single = [at(17, 0, 0.9), at(17, 2, 0.3)];
  const one = buildDayView({ ...options, readings: readingsOf(single) });
  expect(one.points.slice(17 * 60, 17 * 60 + 3).map(point => point.state)).toEqual(['normal', 'normal', 'normal']);
});

test('vigorous: V . . . V bridges two readings 4 minutes apart; a longer gap does not', () => {
  const at = (minute, activity) => ({ time: date(10, 1, 16, minute, 10), activity, activity_valid: 1,
    slave_id: 4, master_id: 7 });
  const three = buildDayView({ ...options, readings: readingsOf([at(0, 0.9), at(3, 0.9), at(4, 0.3)]) });
  expect(three.points.slice(16 * 60, 16 * 60 + 5).map(point => point.state))
    .toEqual(['vigorous', 'vigorous', 'vigorous', 'vigorous', 'normal']);
  const four = buildDayView({ ...options, readings: readingsOf([at(0, 0.9), at(4, 0.9), at(5, 0.3)]) });
  expect(four.points.slice(16 * 60, 16 * 60 + 6).map(point => point.state))
    .toEqual(['vigorous', 'vigorous', 'vigorous', 'vigorous', 'vigorous', 'normal']);
  const five = buildDayView({ ...options, readings: readingsOf([at(0, 0.9), at(5, 0.9), at(6, 0.3)]) });
  expect(five.points.slice(16 * 60, 16 * 60 + 7).map(point => point.state))
    .toEqual(['normal', 'missing', 'missing', 'missing', 'missing', 'normal', 'normal']);
});

// What the real replay of 2026-10-19 showed: a dog lying still sends 0.06–0.09
// (above the old 0.05 line), sparsely, with gaps of 210–250 s now and then
// (4 minutes apart). With the 3-minute fill and 0.05 it never rested.
test('a sparse dog lying at 0.06–0.09 with 210–250 s gaps rests (4-minute fill, 0.10 line)', () => {
  const seconds = [40, 110, 230, 60, 30, 110, 250, 90, 45, 210, 60, 110, 30, 240, 90, 60];
  const values = [0.07, 0.06, 0.09, 0.08, 0.06, 0.07, 0.09, 0.06, 0.08, 0.07, 0.06, 0.09, 0.07, 0.08, 0.06, 0.07];
  const rows = [{ time: date(10, 1, 18, 0, 5), activity: 0.4, activity_valid: 1, slave_id: 4, master_id: 7 }];
  let time = date(10, 1, 18, 1, 5);
  for (let i = 0; i < 40; i += 1) {
    rows.push({ time, activity: values[i % values.length], activity_valid: 1, slave_id: 4, master_id: 7 });
    time += seconds[i % seconds.length] * S;
  }
  const lastCalm = Math.floor(rows[rows.length - 1].time / M) * M;
  const view = buildDayView({ ...options, readings: readingsOf(rows) });
  const tally = states(view, date(10, 1, 18, 1), lastCalm + M);
  expect(tally.missing).toBeUndefined();
  expect(tally).toEqual({ rest: (lastCalm - date(10, 1, 18, 1)) / M + 1 });
  // The card at the newest packet agrees.
  const minutes = activityMinutes(readingsOf(rows), { now: lastCalm + M });
  expect(activityState(minutes, { end: lastCalm })).toMatchObject({ state: 'rest', since: date(10, 1, 18, 1) });
});

test('unplugged → charging: the minutes between are not filled either way', () => {
  const rows = [
    ...sparse(date(10, 1, 15, 0, 5), date(10, 1, 15, 20), 0.02, { usb_present: 0 }),
    ...sparse(date(10, 1, 15, 21, 30), date(10, 1, 15, 40), 0, { usb_present: 1 }),
  ];
  const lastCalm = Math.floor(rows.filter(row => row.usb_present === 0).pop().time / M) * M;
  const view = buildDayView({ ...options, readings: readingsOf(rows) });
  const between = view.points.filter(point => point.minute > lastCalm && point.minute < date(10, 1, 15, 21));
  expect(between.length).toBeGreaterThan(0);
  expect(between.every(point => point.state === 'missing')).toBe(true);
  expect(view.points.find(point => point.minute === date(10, 1, 15, 21)).state).toBe('charging');
});

test('per-minute sums: the running minute and later never fill finished minutes', () => {
  const now = date(10, 1, 9, 5, 30);
  const minutes = [{ minute: date(10, 1, 9, 2), value: 0.3, count: 1 },
    // The minute still running (09:05) and one past it, as a sum could hold.
    { minute: date(10, 1, 9, 5), value: 0.3, count: 1 }, { minute: date(10, 1, 9, 6), value: 0.3, count: 1 }];
  const view = buildDayView({ ...options, date: DAY, now, minutes });
  expect(view.points.slice(9 * 60 + 2).map(point => point.state)).toEqual(['normal', 'missing', 'missing']);
});

test('a year built month by month equals the whole year on sparse minutes', () => {
  const { combineYearView, buildActivityView, activityPeriod } = require('../src/activity/views/ActivityViews');
  const { buildYearView } = require('../src/activity/views');
  const { ACTIVITY_CONTEXT_MS } = require('../src/activity/ActivityData');
  const start = date(8, 25);
  const now = date(10, 7, 9, 30);
  const minutes = [];
  // Every minute but every third and fourth of each block of 7 (gaps of 2 and
  // sometimes 3 minutes), calm around midnight between months.
  for (let t = start, i = 0; t < now; t += M, i += 1) {
    if (i % 7 === 3 || i % 7 === 4 || (i % 97 > 90)) continue;
    // On the charger over the month boundary, a packet every 8 minutes.
    if (t >= date(8, 31, 23, 20) && t < date(9, 1, 0, 50)) {
      if (i % 8 === 0) minutes.push({ minute: t, value: NaN, count: 0, charging: true });
      continue;
    }
    const hour = new Date(t).getHours();
    minutes.push({ minute: t, value: hour < 6 || hour >= 22 ? 0.02 : (i % 13 < 2 ? 0.9 : 0.3), count: 1 });
  }
  const whole = buildYearView({ date: now, now, earliest: start, since: start, minutes });
  const months = [];
  for (let month = 8; month <= 10; month += 1) {
    const period = activityPeriod('month', date(month, 1));
    months.push(buildActivityView({ mode: 'month', date: period.start, now, earliest: date(1, 1), since: start,
      minutes: minutes.filter(item => item.minute >= period.start - ACTIVITY_CONTEXT_MS
        && item.minute < period.end + ACTIVITY_CONTEXT_MS) }));
  }
  const combined = combineYearView({ date: now, now, earliest: start, months });
  expect(combined.totals).toEqual(whole.totals);
  expect(combined.bars).toEqual(whole.bars);
  expect(whole.totals.rest).toBeGreaterThan(0);
  // The charging run is one stretch over the month boundary (split per day
  // as week, month and year list them), no 沒有資料 inside it.
  const charging = combined.rows.find(row => row.state === 'charging').ranges;
  expect(charging).toHaveLength(2);
  expect(charging[0].end).toBe(date(9, 1));
  expect(charging[1].start).toBe(date(9, 1));
});

test('the card\'s newest reading is one that counts, not a cloud copy of a local one', () => {
  const { dogCardReadings } = require('../src/activity/DogCardReadings');
  const now = date(10, 1, 10, 0, 30);
  const local = [{ time: date(10, 1, 9, 58, 50), activity: 0.02, activity_valid: 1, activity_time: '9',
    slave_id: 4, master_id: 7 }];
  // The same reading downloaded back, with the server's later time.
  const cloud = [{ time: date(10, 1, 9, 59, 5), activity: 0.02, activity_valid: 1, activity_time: '9',
    slave_id: 4, master_id: 7 }];
  expect(dogCardReadings({ local, cloud }, now).activity.newestAt).toBe(date(10, 1, 9, 58, 50));
});

// 2026-10-21: on its charger the collar sends only every 4–9 minutes. Between
// two charging minutes a gap of up to 30 minutes is still 充電中; every other
// gap keeps the 4-minute limit, and charging ↔ not charging is never filled.
describe('charging gaps up to 30 minutes', () => {
  const plugged = (hour, minute) => ({ time: date(10, 1, hour, minute, 20), activity: 0, activity_valid: 1,
    usb_present: 1, slave_id: 4, master_id: 7 });
  const loose = (hour, minute, activity = 0.3) => ({ time: date(10, 1, hour, minute, 20), activity,
    activity_valid: 1, usb_present: 0, slave_id: 4, master_id: 7 });

  test('charging packets 5–9 minutes apart are one continuous 充電中', () => {
    const minutes = [0, 6, 11, 20, 27, 33, 42, 50, 55];
    const rows = minutes.map(minute => plugged(13, minute));
    const view = buildDayView({ ...options, readings: readingsOf(rows) });
    expect(states(view, date(10, 1, 13, 0), date(10, 1, 13, 56))).toEqual({ charging: 56 });
    expect(view.rows.find(row => row.state === 'charging').ranges)
      .toEqual([{ start: date(10, 1, 13, 0), end: date(10, 1, 13, 56), durationMinutes: 56 }]);
    // No 沒有資料 between the charging packets.
    expect(view.gaps.filter(gap => gap.start < date(10, 1, 13, 56) && gap.end > date(10, 1, 13, 0))).toEqual([]);
  });

  test('a charging gap of 30 minutes is filled, one of 31 is 沒有資料', () => {
    const thirty = buildDayView({ ...options, readings: readingsOf([plugged(13, 0), plugged(13, 30)]) });
    expect(states(thirty, date(10, 1, 13, 0), date(10, 1, 13, 31))).toEqual({ charging: 31 });
    const longer = buildDayView({ ...options, readings: readingsOf([plugged(13, 0), plugged(13, 31)]) });
    expect(states(longer, date(10, 1, 13, 0), date(10, 1, 13, 32))).toEqual({ charging: 2, missing: 30 });
  });

  test('the 4-minute limit still holds for the dog’s own minutes and across the charger', () => {
    const normal = buildDayView({ ...options, readings: readingsOf([loose(15, 0), loose(15, 6)]) });
    expect(states(normal, date(10, 1, 15, 0), date(10, 1, 15, 7))).toEqual({ normal: 2, missing: 5 });
    // Charging → off the charger 6 minutes later, and back on: never filled.
    const across = buildDayView({ ...options, readings: readingsOf([plugged(16, 0), loose(16, 6),
      plugged(16, 12)]) });
    expect(states(across, date(10, 1, 16, 0), date(10, 1, 16, 13)))
      .toEqual({ charging: 2, normal: 1, missing: 10 });
    // The same at two minutes apart: still not filled.
    const near = buildDayView({ ...options, readings: readingsOf([plugged(17, 0), loose(17, 2)]) });
    expect(states(near, date(10, 1, 17, 0), date(10, 1, 17, 3))).toEqual({ charging: 1, missing: 1, normal: 1 });
  });

  test('a charging run across midnight fills the first minutes of the day, read with the period context', async () => {
    const { ACTIVITY_CONTEXT_MS } = require('../src/activity/ActivityData');
    // On the charger over midnight: packets at 23:46 and 00:15 (29 minutes
    // apart, filled). 23:46 is more than the old 13-minute context before
    // the day: read with only that, the first 15 minutes were 沒有資料.
    const previous = date(9, 30, 23, 46, 20);
    const next = date(10, 1, 0, 15, 20);
    expect(DAY - previous).toBeLessThan(ACTIVITY_CONTEXT_MS);
    const rows = [{ ...plugged(0, 0), time: previous }, { ...plugged(0, 0), time: next }];
    // Only what readActivityPeriod would read: the period with its context.
    const read = rows.filter(row => row.time >= DAY - ACTIVITY_CONTEXT_MS && row.time < DAY + 1440 * M
      + ACTIVITY_CONTEXT_MS);
    const day = buildDayView({ ...options, readings: readingsOf(read) });
    expect(states(day, DAY, date(10, 1, 0, 16))).toEqual({ charging: 16 });
    // The week built from per-minute sums agrees, and so does the day before.
    const week = buildWeekView({ ...options, minutes: sqlMinutes(read) });
    expect(week.bars.find(bar => bar.start === DAY).totals.charging).toBe(day.totals.charging);
    const before = buildDayView({ ...options, date: date(9, 30), readings: readingsOf(rows) });
    expect(states(before, date(9, 30, 23, 46), DAY)).toEqual({ charging: 14 });
    // The context reaches far enough for the longest charging bridge plus
    // the 9 minutes a rest window looks back.
    expect(ACTIVITY_CONTEXT_MS).toBeGreaterThanOrEqual((9 + 30) * M);
  });

  test('the card on the charger: 充電中 at a charging packet, and a rest after it starts there', () => {
    const rows = [plugged(18, 0), plugged(18, 8), plugged(18, 16),
      ...sparse(date(10, 1, 18, 21, 5), date(10, 1, 18, 40), 0.02, { usb_present: 0 })];
    const minutes = activityMinutes(readingsOf(rows), { now: date(10, 1, 18, 40) });
    expect(activityState(minutes, { end: date(10, 1, 18, 16) }).state).toBe('charging');
    const last = Math.floor(rows[rows.length - 1].time / M) * M;
    expect(activityState(minutes, { end: last })).toMatchObject({ state: 'rest', since: date(10, 1, 18, 21) });
    const view = buildDayView({ ...options, readings: readingsOf(rows) });
    expect(states(view, date(10, 1, 18, 0), date(10, 1, 18, 21))).toEqual({ charging: 17, missing: 4 });
  });
});
