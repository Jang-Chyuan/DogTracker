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
  expect(midnight.emptyText).toBe('沒有活動量資料');
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
  expect(view.currentLabel).toBe('這個月');
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
  expect(view.emptyText).toBe('沒有活動量資料');
  expect(view.rows.map(row => row.label)).toEqual(['休息', '劇烈', '沒有資料']);
  expect(view.rows[2].durationText).toBe('24 小時');
  expect(view.rows[2].rangeLabels).toEqual(['00:00–24:00']);
  expect(view.thresholds).toEqual({ restMax: 0.05, vigorousMin: 0.8 });
  expect(view.thresholdBands).toEqual([
    { state: 'rest', min: 0, max: 0.05, label: '低活動 0.05 以下' },
    { state: 'vigorous', min: 0.8, max: 1, label: '高活動 0.8 以上' },
  ]);
  expect(ACTIVITY_VIEW_COPY.legend.map(item => item.label)).toEqual(['休息', '一般', '劇烈']);
  expect(ACTIVITY_VIEW_COPY.low).toBe('低活動 0.05 以下');
  expect(ACTIVITY_VIEW_COPY.high).toBe('高活動 0.8 以上');
  expect(ACTIVITY_VIEW_COPY.explanation).toBe('休息：最近 10 分鐘幾乎沒動；劇烈：最近 2 分鐘一直在激烈活動');
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
    const monthView = buildMonthView({ date: start, now: next });
    expect(monthView.bars[day - 1].capacityMinutes).toBe((next - start) / M);
  }
});
