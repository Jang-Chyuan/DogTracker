import { t as i18nT } from '../src/i18n';
import { activityReadings } from '../src/activity/ActivityMinutes';
import { ACTIVITY_VIEW_COPY, activityPeriod, activityNavigation, buildDayView,
  buildWeekView, buildMonthView, buildYearView } from '../src/activity/views';

const M = 60000;
const date = (month, day, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const START = date(10, 1);
const NOW = date(10, 8, 12);
const input = (start, values) => activityReadings(values.map((activity, i) => ({
  time: start + i * M, activity, slave_id: 4,
})), 'ble');
const options = { date: START, now: NOW, earliest: date(9, 1) };

test('day averages and deduplicates with shared BLE precedence; missing curve is null', () => {
  const readings = [
    { time: START, value: 0.2, key: 'same', source: 'cloud' },
    { time: START, value: 0.4, key: 'same', source: 'ble' },
    { time: START + 30000, value: 0.6, key: 'other', source: 'ble' },
    ...input(START + 2 * M, [0.3]),
  ];
  const original = JSON.stringify(readings);
  const view = buildDayView({ ...options, readings });
  expect(view.points).toHaveLength(1440);
  expect(view.points[0]).toMatchObject({ value: 0.5, count: 2, state: 'normal' });
  expect(view.points[1]).toMatchObject({ value: null, count: 0, state: 'missing' });
  expect(view.totals).toEqual({ rest: 0, normal: 2, vigorous: 0, missing: 1438 });
  expect(view.gaps[0]).toEqual({ start: START + M, end: START + 2 * M, durationMinutes: 1 });
  expect(JSON.stringify(readings)).toBe(original);
});

test('rest backfills eight of ten, excludes holes from totals but keeps continuous band', () => {
  const readings = input(START, [0.05, 0.05, null, 0.05, 0.05, null, 0.05, 0.05, 0.05, 0.05, 0.3]);
  const view = buildDayView({ ...options, readings });
  expect(view.totals.rest).toBe(8);
  expect(view.totals.normal).toBe(1);
  expect(view.bands.rest).toEqual([{ start: START, end: START + 10 * M }]);
  expect(view.points[2].state).toBe('missing');
  expect(view.rows[0].durationText).toBe('8 分');
  expect(view.rows[2].rangeLabels).toEqual(['00:02–00:03', '00:05–00:06', '00:11–24:00']);
});

test('coverage below eight of ten does not rest; sparse observations still count as normal', () => {
  const view = buildDayView({ ...options, readings: input(START,
    [0, null, 0, null, 0, null, 0, 0, 0, 0]) });
  expect(view.totals.rest).toBe(0);
  expect(view.totals.normal).toBe(7);
});

test('vigorous includes 0.8, backfills two, ends on normal and cannot bridge a gap', () => {
  const view = buildDayView({ ...options, readings: input(START, [0.8, 0.9, 0.3, 1, null, 1]) });
  expect(view.totals.vigorous).toBe(2);
  expect(view.bands.vigorous).toEqual([{ start: START, end: START + 2 * M }]);
  expect(view.points.slice(0, 6).map(p => p.state)).toEqual(['vigorous', 'vigorous', 'normal', 'normal', 'missing', 'normal']);
});

test('today excludes unfinished minute and all future time from totals/gaps', () => {
  const now = START + 3 * M + 15000;
  const view = buildDayView({ ...options, now, readings: input(START, [0.3, 0.3, 0.3, 1, 1]) });
  expect(view.label).toBe('10/1（四）今天');
  expect(view.points).toHaveLength(3);
  expect(view.totals).toEqual({ rest: 0, normal: 3, vigorous: 0, missing: 0 });
  expect(view.gaps).toEqual([]);
  expect(view.evaluatedEnd).toBe(START + 3 * M);
  const midnight = buildDayView({ ...options, now: START });
  expect(midnight.points).toEqual([]);
  expect(midnight.rows[2].durationText).toBe('0 分');
  expect(midnight.emptyText).toBe(i18nT('c352'));
});

test('context on either side of midnight preserves backfill without leaking durations', () => {
  const readings = input(START - 9 * M, Array(20).fill(0.01));
  const view = buildDayView({ ...options, readings });
  expect(view.totals.rest).toBe(11);
  expect(view.bands.rest[0].start).toBe(START);
  const cross = buildDayView({ ...options, readings: input(START + 1439 * M, [0.9, 0.9]) });
  expect(cross.totals.vigorous).toBe(1);
  expect(cross.bands.vigorous).toEqual([{ start: START + 1439 * M, end: START + 1440 * M }]);
});

test('gap ranges truncate to three with additional count and full-day copy', () => {
  const day = buildDayView({ ...options, readings: input(START, [null, 0.3, null, 0.3, null, 0.3, null, 0.3]) });
  expect(day.rows[2].rangeLabels).toHaveLength(3);
  expect(day.rows[2].additionalRanges).toBe(2);
  expect(day.rows[2].additionalText).toBe('另外 2 段');
  const week = buildWeekView({ ...options, readings: input(START - M, [0.3]) });
  // Isolate a single whole-day gap between observed days.
  const filled = [...input(date(9, 27), Array(4 * 1440).fill(0.3)),
    ...input(date(10, 2), Array(2 * 1440).fill(0.3))];
  const isolated = buildWeekView({ ...options, readings: filled });
  expect(isolated.rows[2].rangeLabels).toEqual(['10/1（四）整天']);
  expect(week.rows[2].durationMinutes).toBe(7 * 1440 - 1);
});

test('week Sunday boundary and daily bars use full capacity with missing white space', () => {
  const view = buildWeekView({ ...options, readings: input(START, [0.9, 0.9, 0.3]) });
  expect(view.label).toBe('9/27（日）– 10/3（六）');
  expect(view.bars).toHaveLength(7);
  expect(view.points).toEqual([]);
  const bar = view.bars[4];
  expect(bar.label).toBe('10/1（四）');
  expect(bar.segments.map(s => s.state)).toEqual(['rest', 'normal', 'vigorous']);
  expect(bar.segments[2].share).toBeCloseTo(2 / 1440);
  expect(bar.segments[2].height).toBeCloseTo(200 * 2 / 1440);
  expect(bar.missingShare).toBeCloseTo(1437 / 1440);
  expect(bar.pendingMinutes).toBe(0);
  expect(bar.segments.reduce((sum, s) => sum + s.share, bar.missingShare)).toBeCloseTo(1);
});

test('month uses daily bars, future days pending rather than missing', () => {
  const view = buildMonthView({ ...options, now: date(10, 8, 0, 2), readings: input(date(10, 8), [0.9, 0.9, 1]) });
  expect(view.bars).toHaveLength(31);
  expect(view.label).toBe('2026 年 10 月');
  expect(view.currentLabel).toBe(i18nT("c454"));
  expect(view.bars[7].totals.vigorous).toBe(2);
  expect(view.bars[7].pendingMinutes).toBe(1438);
  expect(view.bars[8].pendingMinutes).toBe(1440);
  expect(view.bars[8].totals.missing).toBe(0);
});

test('year uses month capacities including leap February, not averages of daily shares', () => {
  const start = new Date(2024, 1, 1).getTime();
  const view = buildYearView({ date: start, now: new Date(2025, 0, 1).getTime(),
    readings: input(start, [0.8, 0.8]) });
  expect(view.bars).toHaveLength(12);
  expect(view.bars[1].capacityMinutes).toBe(29 * 1440);
  expect(view.bars[1].segments[2].share).toBeCloseTo(2 / (29 * 1440));
  expect(view.bars[0].capacityMinutes).toBe(31 * 1440);
  expect(view.totals.missing).toBe(366 * 1440 - 2);
});

test('empty data, durations, legend and thresholds use A4 text', () => {
  const view = buildDayView(options);
  expect(view.emptyText).toBe(i18nT('c352'));
  expect(view.rows.map(row => row.label)).toEqual([i18nT('c086'), i18nT('c088'), i18nT('c089')]);
  expect(view.rows[2].durationText).toBe('24 小時');
  expect(view.rows[2].rangeLabels).toEqual(['00:00–24:00']);
  expect(view.thresholds).toEqual({ restMax: 0.05, vigorousMin: 0.8 });
  expect(view.thresholdBands).toEqual([
    { state: 'rest', min: 0, max: 0.05, label: i18nT('c086') },
    { state: 'vigorous', min: 0.8, max: 1, label: i18nT('c088') },
  ]);
  expect(ACTIVITY_VIEW_COPY.legend.map(item => item.label)).toEqual([i18nT('c086'), i18nT("c434"), i18nT('c088'), i18nT('c089')]);
  expect(ACTIVITY_VIEW_COPY.low).toBe(i18nT('c086'));
  expect(ACTIVITY_VIEW_COPY.high).toBe(i18nT('c088'));
  expect(ACTIVITY_VIEW_COPY.explanation).toBeUndefined();
  const totals = buildDayView({ ...options, readings: input(START, Array(340).fill(0)) });
  expect(totals.rows[0].durationText).toBe('5 小時 40 分');
});

test.each(['day', 'week', 'month', 'year'])('%s navigation disables earliest/now boundary and provides valid targets', mode => {
  const min = activityPeriod(mode, date(1, 1)).start;
  const max = activityPeriod(mode, NOW).start;
  const first = activityNavigation(mode, min, { earliest: min, now: NOW });
  expect(first.canPrevious).toBe(false);
  expect(first.previous).toBeNull();
  const last = activityNavigation(mode, max, { earliest: min, now: NOW });
  expect(last.canNext).toBe(false);
  expect(last.next).toBeNull();
  if (min !== max) {
    expect(first.next).toBe(activityPeriod(mode, min).end);
    expect(last.previous).toBe(activityPeriod(mode, max - 1).start);
  }
});

test('calendar rollover and invalid inputs', () => {
  expect(activityPeriod('week', date(1, 1)).start).toBe(new Date(2025, 11, 28).getTime());
  expect(activityPeriod('month', date(12, 31)).end).toBe(new Date(2027, 0, 1).getTime());
  expect(() => activityPeriod('bad', START)).toThrow('期間無效');
  expect(() => activityPeriod('day', NaN)).toThrow('日期無效');
  expect(() => buildDayView({ now: NaN })).toThrow('時間無效');
  expect(() => buildDayView({ now: NOW, date: date(10, 9) })).toThrow('超出範圍');
  expect(() => activityNavigation('day', START, { now: NOW, earliest: NOW })).toThrow('超出範圍');
});

test('local calendar days retain DST capacity rather than adding fixed 24 hours', () => {
  // Also exercised under TZ=America/New_York (23 h in March, 25 h in November).
  for (const [month, day] of [[2, 8], [10, 1]]) {
    const start = new Date(2026, month, day).getTime();
    const next = new Date(2026, month, day + 1).getTime();
    const period = activityPeriod('day', start);
    expect(period.end).toBe(next);
    const view = buildDayView({ date: start, now: next });
    expect(view.points.length).toBe((next - start) / M);
    expect(view.bars).toHaveLength(96);
    const minutes = Array.from({ length: (next - start) / M }, (_, i) => ({
      minute: start + i * M, value: 0.3, count: 1,
    }));
    const filled = buildDayView({ date: start, now: next, minutes });
    expect(filled.bars.reduce((sum, bar) => sum + bar.count, 0)).toBe(minutes.length);
    if (minutes.length === 1380) expect(filled.bars.slice(8, 12).every(bar => bar.count === 0)).toBe(true);
    if (minutes.length === 1500) expect(filled.bars.slice(4, 8).every(bar => bar.count === 30)).toBe(true);
    const monthView = buildMonthView({ date: start, now: next });
    expect(monthView.bars[day - 1].capacityMinutes).toBe((next - start) / M);
  }
});

// The one-pass classify() against activityState() judged at every minute (the
// first model's loop), on random minutes with gaps around both thresholds.
describe('classify matches activityState at every minute', () => {
  const { activityState } = require('../src/activity/ActivityMinutes');
  const { classify } = require('../src/activity/views/ActivityViews');
  const reference = values => {
    const n = values.length;
    const rest = new Uint8Array(n);
    const vigorous = new Uint8Array(n);
    for (let t = 0; t < n; t += 1) {
      const window = [];
      for (let k = Math.max(0, t - 9); k <= t; k += 1) {
        if (!Number.isNaN(values[k])) window.push({ minute: k * M, value: values[k] });
      }
      const result = activityState(window, { end: t * M });
      if (result.state !== 'rest' && result.state !== 'vigorous') continue;
      const target = result.state === 'rest' ? rest : vigorous;
      for (let k = result.since / M; k <= t; k += 1) target[k] = 1;
    }
    return { rest, vigorous };
  };
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  test.each([0, 1, 2, 3, 4, 5])('random series %i', () => {
    const values = Float64Array.from({ length: 600 }, (_, i) => {
      const r = random();
      if (r < 0.12) return NaN;
      const phase = Math.floor(i / 40) % 3;
      if (phase === 0) return random() < 0.9 ? 0.03 : 0.2;
      if (phase === 1) return random() < 0.6 ? 0.9 : 0.5;
      return 0.3;
    });
    const fast = classify(values);
    const slow = reference(values);
    expect(Array.from(fast.rest)).toEqual(Array.from(slow.rest));
    expect(Array.from(fast.vigorous)).toEqual(Array.from(slow.vigorous));
  });
});

test('a whole year of minutes builds quickly', () => {
  const start = date(1, 1);
  const now = date(10, 7, 9, 30);
  const minutes = [];
  for (let t = start; t < now; t += M) minutes.push({ minute: t, value: (t / M) % 97 < 30 ? 0.02 : 0.4, count: 2 });
  const began = Date.now();
  const view = buildYearView({ date: now, now, earliest: start, minutes });
  expect(Date.now() - began).toBeLessThan(2000);
  expect(view.bars).toHaveLength(12);
  expect(view.totals.missing).toBe(0);
  expect(view.bars[11].pendingMinutes).toBe(view.bars[11].capacityMinutes);
});

test('年 built month by month equals 年 built at once', () => {
  const { combineYearView, buildActivityView, activityPeriod: periodOf } = require('../src/activity/views/ActivityViews');
  const start = date(3, 16, 8);
  const now = date(10, 7, 9, 30);
  const minutes = [];
  for (let t = start; t < now; t += M) {
    // A rest that runs over midnight into April, gaps over a month end.
    if (t >= date(5, 31, 23, 50) && t < date(6, 2)) continue;
    minutes.push({ minute: t, value: (t / M) % 211 < 90 ? 0.02 : (t / M) % 211 < 95 ? 0.9 : 0.4, count: 1 });
  }
  const whole = buildYearView({ date: now, now, earliest: start, minutes });
  const months = [];
  for (let month = 1; month <= 10; month += 1) {
    const period = periodOf('month', date(month, 1));
    months.push(buildActivityView({ mode: 'month', date: period.start, now, earliest: date(1, 1),
      minutes: minutes.filter(item => item.minute >= period.start - 9 * M && item.minute < period.end + 9 * M) }));
  }
  const combined = combineYearView({ date: now, now, earliest: start, months });
  expect(combined.totals).toEqual(whole.totals);
  expect(combined.bars).toEqual(whole.bars);
  expect(combined.rows).toEqual(whole.rows);
  expect(combined.navigation).toEqual(whole.navigation);
  expect(combined.label).toBe(whole.label);
});

test('time before the dog\'s first reading is not 沒有資料', () => {
  const first = date(10, 1, 12);
  const view = buildDayView({ date: START, now: NOW, earliest: first, since: first,
    readings: input(first, [0.3, 0.3, 0.3]) });
  expect(view.totals).toEqual({ rest: 0, normal: 3, vigorous: 0, missing: 12 * 60 - 3 });
  expect(view.rows[2].rangeLabels).toEqual(['12:03–24:00']);
  expect(view.points[0]).toMatchObject({ value: null, state: 'before' });
  const week = buildWeekView({ date: START, now: NOW, earliest: first, since: first,
    minutes: [{ minute: first, value: 0.3, count: 1 }] });
  expect(week.bars[0].totals).toEqual({ rest: 0, normal: 0, vigorous: 0, missing: 0 });
  expect(week.bars[0].pendingMinutes).toBe(1440);
  expect(week.rows[2].rangeLabels[0]).toBe('10/1（四） 12:01–24:00');
});

test('totals longer than a day read in days and hours (060)', () => {
  const { totalText } = require('../src/activity/views/ActivityViews');
  expect(totalText(340)).toBe('5 小時 40 分');
  expect(totalText(24 * 60)).toBe('24 小時');
  expect(totalText(1981 * 60 + 58)).toBe('82 天 14 小時');
  expect(totalText(48 * 60 + 10)).toBe('2 天');
  expect(totalText(25 * 60)).toBe('1 天 1 小時');
});

test('day has 96 quarter-hour means, exact two-minute vigorous burst wins', () => {
  const values = [0.8, 0.9, ...Array(13).fill(0.02), 0];
  const view = buildDayView({ ...options, readings: input(START, values) });
  expect(view.bars).toHaveLength(96);
  expect(view.bars[0].state).toBe('vigorous');
  expect(view.bars[0].totals.vigorous).toBe(2);
  expect(view.bars[0].value).toBeCloseTo((1.7 + 13 * 0.02) / 15);
  expect(view.bars[0].height).toBeCloseTo(view.bars[0].value * 200);
  expect(view.bars[1]).toMatchObject({ count: 1, value: 0, height: 3 });
});

test('partial today averages present minutes and leaves future slots pending', () => {
  const view = buildDayView({ ...options, now: START + 18 * M + 1000,
    readings: input(START + 15 * M, [0.2, null, 0.6, 1]) });
  expect(view.bars[1]).toMatchObject({ count: 2, value: 0.4, height: 80, pending: false });
  expect(view.bars[2]).toMatchObject({ count: 0, height: 0, pending: true });
  expect(view.bars[0]).toMatchObject({ state: 'missing', height: 0, pending: false });
});

test('all-gap day has no bars but keeps gap summary', () => {
  const view = buildDayView(options);
  expect(view.bars.every(bar => bar.height === 0 && bar.state === 'missing')).toBe(true);
  expect(view.rows[2].durationMinutes).toBe(1440);
});

test('rest versus normal majority uses classified minutes and normal wins ties', () => {
  const { bucketDayMinutes } = require('../src/activity/views');
  const points = ['rest', 'normal', 'vigorous'].map((state, i) => ({
    minute: START + i * M, value: 0.3, state,
  }));
  expect(bucketDayMinutes(points, NOW, START)[0].state).toBe('normal');
  points.push({ minute: START + 3 * M, value: 0, state: 'rest' });
  expect(bucketDayMinutes(points, NOW, START)[0].state).toBe('rest');
});
