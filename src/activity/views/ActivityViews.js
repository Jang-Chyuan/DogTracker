import { ACTIVITY, activityMinutes, durationText, minuteOf } from '../ActivityMinutes';

const MINUTE = 60000;
// A local binding: a global lookup per minute is slow over a year of minutes.
const isNaN = Number.isNaN;
const STATES = ['rest', 'normal', 'vigorous'];
const WORDS = { rest: '休息', normal: '一般', vigorous: '劇烈', missing: '沒有資料' };
const DAYS = '日一二三四五六';

export const ACTIVITY_VIEW_COPY = Object.freeze({
  tabs: Object.freeze(['日', '週', '月', '年']),
  previous: '‹',
  next: '›',
  legend: Object.freeze(STATES.map(state => Object.freeze({ state, label: WORDS[state] }))),
  low: '休息',
  high: '劇烈',
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
// A4 totals: 「5 小時 40 分」 up to a day; longer totals (a month's, a year's
// 休息 or 沒有資料) in days and whole hours, 「82 天 14 小時」 — the design gives
// no form for them, and 「1981 小時 58 分」 cannot be read at a glance.
export function totalText(minutes) {
  if (Number.isFinite(minutes) && Math.round(minutes) > 24 * 60) {
    const hours = Math.round(minutes / 60);
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    return rest ? `${days} 天 ${rest} 小時` : `${days} 天`;
  }
  return durationText(minutes).replace('分鐘', '分');
}
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

function rangeLabel(span, period) {
  const endClock = span.end === dayStart(span.end) ? '24:00' : clock(span.end);
  if (period.mode === 'day') return `${clock(span.start)}–${endClock}`;
  const fullDay = span.start === dayStart(span.start) && span.end === addDays(span.start, 1);
  if (fullDay) return `${dateLabel(span.start)}整天`;
  // Week, month and year spans never cross midnight (split per day).
  return `${dateLabel(span.start)} ${clock(span.start)}–${endClock}`;
}

// Week/month/year: a gap that runs over midnight is listed per day, so each
// day reads 「10/1（四）整天」 or 「10/2（五） 08:40–09:10」.
function splitByDay(list) {
  const result = [];
  for (const span of list) {
    for (let start = span.start; start < span.end;) {
      const end = Math.min(span.end, addDays(dayStart(start), 1));
      result.push({ start, end, durationMinutes: (end - start) / MINUTE });
      start = end;
    }
  }
  return result;
}

// Under each bar: the weekday (週), the date every few days (月), the month (年).
function axisLabel(mode, start) {
  const d = new Date(start);
  if (mode === 'week') return DAYS[d.getDay()];
  if (mode === 'year') return `${d.getMonth() + 1}月`;
  const day = d.getDate();
  return day === 1 || day % 5 === 0 ? String(day) : '';
}

/**
 * The 休息／劇烈 runs over one slot per minute (NaN = no data), the same rules
 * as ActivityMinutes.activityState judged at the end of every minute, in one
 * pass (a year is ~500,000 minutes): 劇烈 when a minute and the one before are
 * both at least vigorousMin (the pair counts); 休息 when the last restMinutes
 * have at least coverage of their minutes with data and every one at most
 * restMax, from the window's first minute with data. Returns per slot whether
 * a 休息 / 劇烈 run covers it (missing minutes inside a run stay missing for
 * the totals, but the run's ground is continuous).
 */
export function classify(values, config = ACTIVITY) {
  const n = values.length;
  const size = config.restMinutes;
  const needs = Math.ceil(size * config.coverage - 1e-9);
  const pair = config.vigorousMinutes;
  const restMax = config.restMax;
  const vigorousMin = config.vigorousMin;
  // Prefix counts of minutes with data and of those above restMax; the next
  // minute with data from each slot (NaN: no data).
  const data = new Int32Array(n + 1);
  const bad = new Int32Array(n + 1);
  const nextData = new Int32Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    const has = isNaN(v) ? 0 : 1;
    data[i + 1] = data[i] + has;
    bad[i + 1] = bad[i] + (has && v > restMax ? 1 : 0);
  }
  nextData[n] = n;
  for (let i = n - 1; i >= 0; i -= 1) nextData[i] = isNaN(values[i]) ? nextData[i + 1] : i;
  const restDiff = new Int32Array(n + 1);
  const vigorousDiff = new Int32Array(n + 1);
  let high = 0;
  for (let t = 0; t < n; t += 1) {
    const v = values[t];
    high = v >= vigorousMin ? high + 1 : 0;
    const from = t - size + 1 > 0 ? t - size + 1 : 0;
    if (high >= pair) {
      const since = t - high + 1 > from ? t - high + 1 : from;
      vigorousDiff[since] += 1;
      vigorousDiff[t + 1] -= 1;
    } else if (data[t + 1] - data[from] >= needs && bad[t + 1] === bad[from]) {
      restDiff[nextData[from]] += 1;
      restDiff[t + 1] -= 1;
    }
  }
  const rest = new Uint8Array(n);
  const vigorous = new Uint8Array(n);
  let r = 0;
  let w = 0;
  for (let i = 0; i < n; i += 1) {
    r += restDiff[i];
    w += vigorousDiff[i];
    if (r > 0) rest[i] = 1;
    if (w > 0) vigorous[i] = 1;
  }
  return { rest, vigorous };
}

/** Pure input: activityReadings() for ONE dog, including at least 9 minutes
 * before/after the selected period when available. Reuses shared aggregation
 * and classification; callers supply now for reproducible results. No I/O.
 * Future/unfinished minutes are excluded, not reported as missing.
 * `minutes` (activityMinutes() shape, finished minutes only) replaces
 * `readings` when the store already averaged per minute (week, month, year).
 * `since`: the dog's first reading. Time before it is not 沒有資料 (there was
 * no record yet); like time still to come it is left blank and not counted.
 */
export function buildActivityView({ mode = 'day', date, now, earliest, since = null, readings = [],
  minutes: given = null }) {
  if (!Number.isFinite(now)) throw new Error('活動量時間無效');
  const period = activityPeriod(mode, date ?? now);
  const navigation = activityNavigation(mode, date ?? now, { now, earliest });
  const end = Math.min(period.end, minuteOf(now));
  const current = minuteOf(now);
  // Given minutes past the last finished one are skipped below (limit).
  const minutes = given ?? activityMinutes(readings, { now });
  // One slot per minute from 9 minutes before the period (a run that began
  // just before still fills back) to the last finished minute it needs.
  const base = period.start - 9 * MINUTE;
  const limit = Math.min(end + 9 * MINUTE, current);
  const n = Math.max(0, Math.round((limit - base) / MINUTE));
  const values = new Float64Array(n).fill(NaN);
  const counts = new Uint16Array(n);
  for (let i = 0; i < minutes.length; i += 1) {
    const item = minutes[i];
    // Minutes are whole (minuteOf), so the slot is exact.
    const index = (item.minute - base) / MINUTE;
    if (index >= 0 && index < n) {
      values[index] = item.value;
      const count = item.count ?? 1;
      counts[index] = count > 65535 ? 65535 : count;
    }
  }
  const { rest, vigorous } = classify(values, ACTIVITY);
  // Period minutes: 0 missing, 1 normal, 2 rest, 3 vigorous.
  const first = 9;
  const last = Math.max(first, Math.round((end - base) / MINUTE));
  const length = last - first;
  const states = new Uint8Array(length);
  // Period minutes before the dog's first reading (state 4: not counted).
  const before = Number.isFinite(since) ? Math.max(0, Math.floor((minuteOf(since) - period.start) / MINUTE)) : 0;
  for (let i = 0; i < length; i += 1) {
    const k = first + i;
    if (k >= n || isNaN(values[k])) states[i] = before > i ? 4 : 0;
    else states[i] = vigorous[k] ? 3 : rest[k] ? 2 : 1;
  }
  const at = i => period.start + i * MINUTE;
  // Spans of `array[offset + i] === code` over the period, in time.
  const runsOf = (array, code, offset = 0) => {
    const result = [];
    let open = -1;
    for (let i = 0; i <= length; i += 1) {
      const k = offset + i;
      const hit = i < length && k < array.length && array[k] === code;
      if (hit && open < 0) open = i;
      else if (!hit && open >= 0) {
        result.push({ start: at(open), end: at(i), durationMinutes: i - open });
        open = -1;
      }
    }
    return result;
  };
  const band = cover => runsOf(cover, 1, first).map(({ start, end: stop }) => ({ start, end: stop }));
  const bands = { rest: band(rest), vigorous: band(vigorous) };
  const CODE = { missing: 0, normal: 1, rest: 2, vigorous: 3 };
  const totals = { rest: 0, normal: 0, vigorous: 0, missing: 0 };
  const NAMES = ['missing', 'normal', 'rest', 'vigorous', 'before'];
  const tallies = [0, 0, 0, 0, 0];
  for (let i = 0; i < length; i += 1) tallies[states[i]] += 1;
  NAMES.slice(0, 4).forEach((name, code) => { totals[name] = tallies[code]; });
  const points = [];
  if (mode === 'day') {
    for (let i = 0; i < length; i += 1) {
      const k = first + i;
      const has = states[i] !== 0 && states[i] !== 4;
      points.push({ minute: at(i), value: has ? values[k] : null, count: has ? counts[k] : 0, state: NAMES[states[i]] });
    }
  }
  const gaps = runsOf(states, 0);
  const own = { rest: runsOf(states, CODE.rest), vigorous: runsOf(states, CODE.vigorous), missing: gaps };
  const ranges = {};
  for (const state of ['rest', 'vigorous', 'missing']) ranges[state] = mode === 'day' ? own[state] : splitByDay(own[state]);
  const bars = [];
  if (mode !== 'day') {
    let index = 0;
    for (let start = period.start; start < period.end;) {
      const d = new Date(start);
      const stop = mode === 'year' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : addDays(start, 1);
      const counted = [0, 0, 0, 0, 0];
      const stopIndex = Math.round((stop - period.start) / MINUTE);
      while (index < length && index < stopIndex) counted[states[index++]] += 1;
      bars.push(barOf(mode, start, stop,
        { missing: counted[0], normal: counted[1], rest: counted[2], vigorous: counted[3] }));
      start = stop;
    }
  }
  return finish({ mode, period, navigation, now, end, totals, ranges, bars, points, bands, gaps });
}

function barOf(mode, start, stop, tally) {
  const d = new Date(start);
  const capacityMinutes = (stop - start) / MINUTE;
  return { start, end: stop, label: mode === 'year' ? `${d.getMonth() + 1}月` : dateLabel(start),
    axisLabel: axisLabel(mode, start),
    capacityMinutes, totals: tally, missingShare: tally.missing / capacityMinutes,
    pendingMinutes: capacityMinutes - Object.values(tally).reduce((x, y) => x + y, 0),
    segments: STATES.map(state => ({ state, label: WORDS[state], minutes: tally[state],
      share: tally[state] / capacityMinutes, height: tally[state] / capacityMinutes * 200 })) };
}

function finish({ mode, period, navigation, now, end, totals, ranges, bars, points, bands, gaps }) {
  const rows = ['rest', 'vigorous', 'missing'].map(state => {
    const list = ranges[state];
    return { state, label: WORDS[state], durationMinutes: totals[state], durationText: totalText(totals[state]),
      ranges: list, rangeLabels: list.slice(0, 3).map(span => rangeLabel(span, period)),
      additionalRanges: Math.max(0, list.length - 3),
      additionalText: list.length > 3 ? `另外 ${list.length - 3} 段` : null };
  });
  const isCurrent = activityPeriod(mode, now).start === period.start;
  return { ...period, label: period.label + (mode === 'day' && isCurrent ? '今天' : ''),
    evaluatedEnd: end, currentLabel: isCurrent ? ACTIVITY_VIEW_COPY.current[mode] : null,
    // Above the summary rows: 今天／這一週… for the running period, else its dates.
    summaryLabel: isCurrent ? ACTIVITY_VIEW_COPY.current[mode] : period.label,
    navigation, points, bands, gaps, totals, rows, bars,
    thresholds: { restMax: ACTIVITY.restMax, vigorousMin: ACTIVITY.vigorousMin },
    thresholdBands: [
      { state: 'rest', min: 0, max: ACTIVITY.restMax, label: ACTIVITY_VIEW_COPY.low },
      { state: 'vigorous', min: ACTIVITY.vigorousMin, max: 1, label: ACTIVITY_VIEW_COPY.high },
    ],
    copy: ACTIVITY_VIEW_COPY, emptyText: totals.rest + totals.normal + totals.vigorous === 0 ? ACTIVITY_VIEW_COPY.empty : null };
}


/**
 * 年 from its months, each built with buildActivityView({ mode: 'month' })
 * (so a year is read and judged a month at a time, with a pause between, and
 * the screen stays responsive). Minutes are judged across month boundaries
 * because every month is read with its 9 minutes of context.
 */
export function combineYearView({ date, now, earliest, months }) {
  const period = activityPeriod('year', date ?? now);
  const navigation = activityNavigation('year', date ?? now, { now, earliest });
  const totals = { rest: 0, normal: 0, vigorous: 0, missing: 0 };
  const ranges = { rest: [], vigorous: [], missing: [] };
  const gaps = [];
  const bars = [];
  const byStart = new Map(months.map(view => [view.start, view]));
  for (let start = period.start; start < period.end;) {
    const d = new Date(start);
    const stop = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const month = byStart.get(start);
    const tally = { rest: 0, normal: 0, vigorous: 0, missing: 0 };
    if (month) {
      for (const state of Object.keys(tally)) {
        tally[state] = month.totals[state];
        totals[state] += month.totals[state];
      }
      for (const row of month.rows) ranges[row.state].push(...row.ranges);
      gaps.push(...month.gaps);
    }
    bars.push(barOf('year', start, stop, tally));
    start = stop;
  }
  const end = Math.min(period.end, minuteOf(now));
  return finish({ mode: 'year', period, navigation, now, end, totals, ranges, bars, points: [],
    bands: { rest: [], vigorous: [] }, gaps });
}

export const buildDayView = options => buildActivityView({ ...options, mode: 'day' });
export const buildWeekView = options => buildActivityView({ ...options, mode: 'week' });
export const buildMonthView = options => buildActivityView({ ...options, mode: 'month' });
export const buildYearView = options => buildActivityView({ ...options, mode: 'year' });
