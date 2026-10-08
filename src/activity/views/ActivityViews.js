import { ACTIVITY, activityMinutes, activityState, durationText, minuteOf } from '../ActivityMinutes';

const MINUTE = 60000;
const STATES = ['rest', 'normal', 'vigorous'];
const WORDS = { rest: '休息', normal: '一般', vigorous: '劇烈', missing: '沒有資料' };
const DAYS = '日一二三四五六';

export const ACTIVITY_VIEW_COPY = Object.freeze({
  tabs: Object.freeze(['日', '週', '月', '年']),
  previous: '‹',
  next: '›',
  legend: Object.freeze(STATES.map(state => Object.freeze({ state, label: WORDS[state] }))),
  low: `低活動 ${ACTIVITY.restMax} 以下`,
  high: `高活動 ${ACTIVITY.vigorousMin} 以上`,
  explanation: `休息：最近 ${ACTIVITY.restMinutes} 分鐘幾乎沒動；劇烈：最近 ${ACTIVITY.vigorousMinutes} 分鐘一直在激烈活動`,
  provisional: '門檻暫定',
  empty: '沒有活動量資料',
  missing: '沒有資料',
  current: Object.freeze({ day: '今天', week: '這一週', month: '這個月', year: '這一年' }),
});

const dateLabel = time => {
  const date = new Date(time);
  return `${date.getMonth() + 1}/${date.getDate()}（${DAYS[date.getDay()]}）`;
};
const clock = time => {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const totalText = minutes => durationText(minutes).replace('分鐘', '分');
const dayStart = time => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const addDays = (time, count) => {
  const date = new Date(time);
  date.setDate(date.getDate() + count);
  return date.getTime();
};

/** Device-local calendar boundaries, exclusive end. Week starts on Sunday.
 * Calendar arithmetic preserves leap years and 23/25-hour DST days. */
export function activityPeriod(mode, date) {
  if (!['day', 'week', 'month', 'year'].includes(mode)) throw new Error('活動量期間無效');
  if (!Number.isFinite(date)) throw new Error('活動量日期無效');
  const value = new Date(date);
  let start = dayStart(date);
  if (mode === 'week') start = addDays(start, -value.getDay());
  if (mode === 'month') start = new Date(value.getFullYear(), value.getMonth(), 1).getTime();
  if (mode === 'year') start = new Date(value.getFullYear(), 0, 1).getTime();
  const first = new Date(start);
  const end = mode === 'day' ? addDays(start, 1) : mode === 'week' ? addDays(start, 7)
    : new Date(first.getFullYear() + (mode === 'year' ? 1 : 0),
      mode === 'year' ? 0 : first.getMonth() + 1, 1).getTime();
  const label = mode === 'day' ? dateLabel(start) : mode === 'week'
    ? `${dateLabel(start)}– ${dateLabel(addDays(end, -1))}`
    : mode === 'month' ? `${first.getFullYear()} 年 ${first.getMonth() + 1} 月` : `${first.getFullYear()} 年`;
  return { mode, start, end, label };
}

/** Bounds are calendar periods containing earliest and now. Disabled targets are null. */
export function activityNavigation(mode, date, { now, earliest }) {
  const period = activityPeriod(mode, date);
  const min = activityPeriod(mode, earliest ?? date).start;
  const max = activityPeriod(mode, now).start;
  if (min > max || period.start < min || period.start > max) throw new Error('活動量日期超出範圍');
  const previous = activityPeriod(mode, period.start - 1).start;
  const next = period.end;
  return { canPrevious: previous >= min, canNext: next <= max,
    previous: previous >= min ? previous : null, next: next <= max ? next : null };
}

function spans(points, state) {
  const result = [];
  for (const point of points) {
    if (point.state !== state) continue;
    const last = result[result.length - 1];
    if (last?.end === point.minute) last.end += MINUTE;
    else result.push({ start: point.minute, end: point.minute + MINUTE });
  }
  return result.map(span => ({ ...span, durationMinutes: (span.end - span.start) / MINUTE }));
}

function rangeLabel(span, period) {
  if (period.mode === 'day') return `${clock(span.start)}–${span.end === period.end ? '24:00' : clock(span.end)}`;
  const fullDay = span.start === dayStart(span.start) && span.end === addDays(span.start, 1);
  if (fullDay) return `${dateLabel(span.start)}整天`;
  return `${dateLabel(span.start)} ${clock(span.start)}–${dateLabel(span.end)} ${clock(span.end)}`;
}

/** Pure input: activityReadings() for ONE dog, including at least 9 minutes
 * before/after the selected period when available. Reuses shared aggregation
 * and classification; callers supply now for reproducible results. No I/O.
 * Future/unfinished minutes are excluded, not reported as missing.
 */
export function buildActivityView({ mode = 'day', date, now, earliest, readings = [] }) {
  if (!Number.isFinite(now)) throw new Error('活動量時間無效');
  const period = activityPeriod(mode, date ?? now);
  const navigation = activityNavigation(mode, date ?? now, { now, earliest });
  const end = Math.min(period.end, minuteOf(now));
  const minutes = activityMinutes(readings, { now });
  const lookup = new Map(minutes.filter(item => item.minute >= period.start - 9 * MINUTE
    && item.minute < end + 9 * MINUTE).map(item => [item.minute, item]));
  const classes = new Map();
  // Bounded ten-minute windows avoid quadratic scans for year-sized input.
  // Backfill only observed minutes; missing minutes remain missing.
  const bands = { rest: [], vigorous: [] };
  for (let time = period.start - 9 * MINUTE; time < Math.min(end + 9 * MINUTE, minuteOf(now)); time += MINUTE) {
    const window = [];
    for (let offset = 9; offset >= 0; offset -= 1) {
      const item = lookup.get(time - offset * MINUTE);
      if (item) window.push(item);
    }
    const result = activityState(window, { end: time });
    if (result.state !== 'rest' && result.state !== 'vigorous') continue;
    const from = Math.max(period.start, result.since);
    const to = Math.min(end, time + MINUTE);
    if (to <= from) continue;
    const list = bands[result.state];
    const last = list[list.length - 1];
    if (last && last.end >= from) last.end = Math.max(last.end, to);
    else list.push({ start: from, end: to });
    for (let t = from; t < to; t += MINUTE) if (lookup.has(t)) classes.set(t, result.state);
  }
  const points = [];
  for (let minute = period.start; minute < end; minute += MINUTE) {
    const item = lookup.get(minute);
    points.push({ minute, value: item?.value ?? null, count: item?.count ?? 0,
      state: item ? classes.get(minute) ?? 'normal' : 'missing' });
  }
  const totals = { rest: 0, normal: 0, vigorous: 0, missing: 0 };
  for (const point of points) totals[point.state] += 1;
  const gaps = spans(points, 'missing');
  const rows = ['rest', 'vigorous', 'missing'].map(state => {
    const ranges = state === 'missing' ? gaps : spans(points, state);
    return { state, label: WORDS[state], durationMinutes: totals[state], durationText: totalText(totals[state]),
      ranges, rangeLabels: ranges.slice(0, 3).map(span => rangeLabel(span, period)),
      additionalRanges: Math.max(0, ranges.length - 3),
      additionalText: ranges.length > 3 ? `另外 ${ranges.length - 3} 段` : null };
  });
  const bars = [];
  if (mode !== 'day') {
    let index = 0;
    for (let start = period.start; start < period.end;) {
      const d = new Date(start);
      const stop = mode === 'year' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : addDays(start, 1);
      const counts = { rest: 0, normal: 0, vigorous: 0, missing: 0 };
      while (index < points.length && points[index].minute < stop) counts[points[index++].state] += 1;
      const capacityMinutes = (stop - start) / MINUTE;
      bars.push({ start, end: stop, label: mode === 'year' ? `${d.getMonth() + 1}月` : dateLabel(start),
        capacityMinutes, totals: counts, missingShare: counts.missing / capacityMinutes,
        pendingMinutes: capacityMinutes - Object.values(counts).reduce((a, b) => a + b, 0),
        segments: STATES.map(state => ({ state, label: WORDS[state], minutes: counts[state],
          share: counts[state] / capacityMinutes, height: counts[state] / capacityMinutes * 200 })) });
      start = stop;
    }
  }
  const current = activityPeriod(mode, now).start === period.start;
  return { ...period, label: period.label + (mode === 'day' && current ? '今天' : ''),
    evaluatedEnd: end, currentLabel: current ? ACTIVITY_VIEW_COPY.current[mode] : null,
    navigation, points: mode === 'day' ? points : [], bands, gaps, totals, rows, bars,
    thresholds: { restMax: ACTIVITY.restMax, vigorousMin: ACTIVITY.vigorousMin },
    thresholdBands: [
      { state: 'rest', min: 0, max: ACTIVITY.restMax, label: ACTIVITY_VIEW_COPY.low },
      { state: 'vigorous', min: ACTIVITY.vigorousMin, max: 1, label: ACTIVITY_VIEW_COPY.high },
    ],
    copy: ACTIVITY_VIEW_COPY, emptyText: totals.rest + totals.normal + totals.vigorous === 0 ? ACTIVITY_VIEW_COPY.empty : null };
}

export const buildDayView = options => buildActivityView({ ...options, mode: 'day' });
export const buildWeekView = options => buildActivityView({ ...options, mode: 'week' });
export const buildMonthView = options => buildActivityView({ ...options, mode: 'month' });
export const buildYearView = options => buildActivityView({ ...options, mode: 'year' });
