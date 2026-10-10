import { t } from '../../i18n';
// The history's calendar (054b; H3b 選日期, H3e 選月份) and the download of
// a day only the cloud holds (H3c, H3d). Pure: day keys are local
// 「YYYY-MM-DD」 strings (HistoryScreenDates.dayKey), compared as strings.
//
// What is known about the days of one dog (or my route) — `knowledge`:
//   local:        days this phone holds rows of
//   cloud:        days the cloud was found to hold (whether or not local)
//   checked:      days the cloud was asked about (a walk or a month check)
//   earliest:     the cloud's earliest day for this dog, once asked
//   cloudEnabled: the cloud counts at all (a dog, signed in, source not 「本機」)
//   query:        'idle' | 'querying' | 'failed' — the cloud question now
// A day the cloud was not asked about yet is 'unknown': not grey (判定表
// 「月曆查詢雲端失敗」「月曆查詢中可以點哪些」).
import { dayBounds, dayKey } from './HistoryScreenDates';
import { fontScale } from '../../theme/tokens';

const pad = n => String(n).padStart(2, '0');
const WEEKDAY_NAMES = [t("c444"), t("c687"), t("c688"), t("c689"), t("c690"), t("c691"), t("c692")];
export const CALENDAR_WEEKDAYS = WEEKDAY_NAMES;

const asSet = value => (value instanceof Set ? value : new Set(value || []));
const monthKeyOf = day => day.slice(0, 7);

/** 「9/28」 (the date row's form: 「10/03」). */
export function shortDate(day) {
  return `${Number(day.slice(5, 7))}/${day.slice(8, 10)}`;
}

/** The knowledge with defaults, sets for lookups. */
export function calendarKnowledge(value = {}) {
  return {
    // The earliest day is itself a day the cloud holds rows on.
    local: asSet(value.local), cloud: asSet([...(value.cloud || []), ...(value.earliest ? [value.earliest] : [])]),
    checked: asSet(value.checked),
    ensureUnknown: !!value.ensureUnknown, earliest: value.earliest ?? null, cloudEnabled: !!value.cloudEnabled, query: value.query ?? 'idle',
    // Days whose download was cancelled or failed: this phone holds part.
    incomplete: asSet(value.incomplete),
  };
}

/** The earliest day anything is known to hold rows (null: none). */
export function earliestKnownDay(knowledge) {
  const k = calendarKnowledge(knowledge);
  const all = [...k.local, ...(k.cloudEnabled ? k.cloud : []), ...(k.cloudEnabled && k.earliest ? [k.earliest] : [])];
  return all.length ? all.sort()[0] : null;
}

/**
 * One day: 'future', 'local' (this phone holds it), 'partial' (this phone
 * holds part: its download was not finished; chosen, it is downloaded again),
 * 'cloud' (only the cloud does: chosen, it is downloaded first), 'empty' (no
 * records), or 'unknown' (the cloud was not asked yet, or the question failed).
 */
export function dayState(day, today, knowledge) {
  const k = calendarKnowledge(knowledge);
  if (day > today) return 'future';
  if (k.cloudEnabled && k.incomplete.has(day)) return 'partial';
  if (k.local.has(day)) return 'local';
  if (k.cloudEnabled && k.cloud.has(day)) return 'cloud';
  if (!k.cloudEnabled || k.checked.has(day) || (k.earliest && day < k.earliest)) return 'empty';
  return 'unknown';
}

/**
 * What a day can do (H3b): a dot under days with records (this phone or the
 * cloud alike); grey and untappable for no records and the future; today is
 * always tappable (H8 when empty). An unknown day waits while the cloud is
 * asked (normal colour, untappable) and is tappable once the question failed
 * (it is downloaded like a cloud day).
 */
export function dayCell(day, { today, selected, knowledge, inMonth = true }) {
  const k = calendarKnowledge(knowledge);
  const state = dayState(day, today, k);
  const isToday = day === today;
  const records = state === 'local' || state === 'cloud' || state === 'partial';
  const tappable = records || isToday || (state === 'unknown' && (k.query === 'failed' || k.ensureUnknown));
  const muted = !tappable && state !== 'unknown';
  const [y, m, d] = day.split('-').map(Number);
  const date = t("c678", { m: m, d: d });
  let label = date;
  // 設計稿「月曆」TalkBack: 「今天，」 in front (「已選取」 comes from the state).
  if (isToday) label = ((records) ? t("c676", { date: date }) : t("c677", { date: date }));
  else if (state === 'future') label = t("c680", { date: date });
  else if (state === 'empty') label = t("c681", { date: date });
  else if (state === 'cloud') label = t("c682", { date: date });
  else if (state === 'partial') label = t("c683", { date: date });
  else if (state === 'local') label = t("c684", { date: date });
  // Not asked yet: 查詢中 while the cloud is asked; after a failed question,
  // not known (it can still be chosen and downloaded).
  else label = k.query === 'failed' ? t("c685", { date: date }) : t("c679", { date: date });
  return { day, year: y, month: m, date: d, inMonth, state, dot: records, today: isToday,
    selected: day === selected, tappable, muted, label };
}

/** The six-or-fewer weeks of a month: the last days of the previous month first. */
export function monthDays(year, month) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  const count = Math.ceil((first.getDay() + new Date(year, month, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { day: dayKey(date), inMonth: date.getMonth() === month - 1 };
  });
}

/**
 * The month view (H3b): 「2026 年 10 月」, its weeks, ‹ › (one month at a
 * time; ‹ down to the earliest known month, › not past this month; nothing
 * known at all: only this month), 回到今天 (only useful on another day) and
 * the line above the calendar (查詢中… / 雲端的紀錄查不到).
 */
export function calendarMonth({ year, month, today, selected, knowledge }) {
  const k = calendarKnowledge(knowledge);
  const key = `${year}-${pad(month)}`;
  const cells = monthDays(year, month).map(({ day, inMonth }) => dayCell(day, { today, selected, knowledge: k, inMonth }));
  const earliest = earliestKnownDay(k);
  const lowest = earliest ? monthKeyOf(earliest) : monthKeyOf(today);
  return {
    year, month, key, title: t("c675", { year: year, month: month }), cells,
    weeks: Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7)),
    previousEnabled: key > lowest, nextEnabled: key < monthKeyOf(today),
    returnTodayEnabled: selected !== today,
    status: k.cloudEnabled && k.query !== 'idle' ? k.query : null,
  };
}

// 200% 字體 (設計稿「月曆在 200% 字體」): from this system font scale on, the
// month grid becomes a list of days (Android's steps are 1.3, 1.5, 1.8, 2.0;
// at 1.5 the 44dp cells still hold a date and its dot, at 1.8 they do not).
export const CALENDAR_LIST_FONT_SCALE = fontScale.calendarList;

/**
 * The month as the 200% list: only the days with records and today (today
 * even without records, then without a dot); after a failed cloud question
 * also the days not yet known, as on the grid (判定表「月曆查詢雲端失敗」).
 * Newest first. Each row: { day, title 「10 月 3 日（六）」, today, dot,
 * selected, label } — label is the grid cell's TalkBack sentence (已選取
 * comes from accessibilityState, as on the grid).
 */
export function calendarDayList(month) {
  return month.cells
    .filter(cell => cell.inMonth && (cell.dot || cell.today || (cell.tappable && cell.state === 'unknown')))
    .map(cell => {
      const weekday = WEEKDAY_NAMES[new Date(cell.year, cell.month - 1, cell.date).getDay()];
      return {
        day: cell.day,
        title: t("c674", { month: cell.month, date: cell.date, weekday: weekday }),
        today: cell.today,
        dot: cell.dot,
        selected: cell.selected,
        label: cell.label,
      };
    })
    .reverse();
}

/** The month before / after 「YYYY-MM」 as { year, month }. */
export function shiftMonth({ year, month }, by) {
  const date = new Date(year, month - 1 + by, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** The days of a month up to today (none for a future month). */
export function pastDaysOf(year, month, today) {
  const days = [];
  for (let d = 1; d <= new Date(year, month, 0).getDate(); d += 1) {
    const day = `${year}-${pad(month)}-${pad(d)}`;
    if (day > today) break;
    days.push(day);
  }
  return days;
}

/**
 * The month picker (H3e): ‹ 2026 年 ›, twelve months. A month with records
 * has a dot; no records (known) or the future is grey and untappable; this
 * month is always tappable (the way back to today); a month the cloud was not
 * asked about is in normal colour and tappable. ‹ goes down to the earliest
 * known year, › not past this year.
 */
export function monthPicker({ year, today, shown = null, knowledge }) {
  const k = calendarKnowledge(knowledge);
  const thisMonth = monthKeyOf(today);
  const earliest = earliestKnownDay(k);
  const lowestYear = Number((earliest ?? today).slice(0, 4));
  const records = new Set([...k.local, ...(k.cloudEnabled ? k.cloud : [])].map(monthKeyOf));
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${pad(i + 1)}`;
    let state;
    if (key > thisMonth) state = 'future';
    else if (records.has(key)) state = 'records';
    else if (pastDaysOf(year, i + 1, today).every(day => dayState(day, today, k) === 'empty')) state = 'empty';
    else state = 'unknown';
    const tappable = state === 'records' || state === 'unknown' || key === thisMonth;
    return { month: i + 1, key, label: t("c694", { value: i + 1 }), state, dot: state === 'records', tappable,
      muted: !tappable, selected: key === shown };
  });
  return { year, title: t("c693", { year: year }), months, previousEnabled: year > lowestYear,
    nextEnabled: year < Number(today.slice(0, 4)),
    status: k.cloudEnabled && k.query !== 'idle' ? k.query : null };
}

/** The months of `year` (up to this month) the cloud should be asked about. */
export function monthsToCheck(year, today, knowledge) {
  return monthPicker({ year, today, knowledge }).months
    .filter(entry => entry.state === 'unknown').map(entry => entry.month);
}

/**
 * What choosing `day` does (⑥ 點一天, ⑦): nothing for a day that cannot be
 * chosen (no feedback at all), 'show' a day this phone holds (or today),
 * 'download' a day only the cloud holds (or an unknown one after a failed
 * question), 'offline' when that needs the network and there is none (the
 * calendar stays, the day does not change).
 */
export function chooseDay(day, { today, knowledge, online = true }) {
  const cell = dayCell(day, { today, selected: null, knowledge });
  if (!cell.tappable) return { type: 'none' };
  // Today is always tappable, but its rows only in the cloud are still downloaded.
  if (cell.state === 'local' || cell.state === 'empty' || (cell.today && !['cloud', 'partial'].includes(cell.state) && !knowledge.ensureUnknown)) return { type: 'show', day };
  if (!online) return { type: 'offline', day, message: offlineMessage(day) };
  return { type: 'download', day };
}

export const offlineMessage = day => t('c157', { date: shortDate(day) });

/**
 * The days the date row's ‹ › step between: this phone's and the cloud days
 * found (判定表「月曆查詢失敗時的 ‹ ›」).
 */
export function knownDays(knowledge) {
  const k = calendarKnowledge(knowledge);
  return [...new Set([...k.local, ...(k.cloudEnabled ? k.cloud : [])])].sort();
}

// ---- asking the cloud ------------------------------------------------------

/** The day keys a time range [from, to) touches. */
export function daysBetween(from, to) {
  if (!(to > from)) return [];
  const out = [];
  let date = new Date(from);
  date = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const last = dayKey(new Date(to - 1));
  for (let key = dayKey(date); key <= last; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
    key = dayKey(date)) {
    out.push(key);
  }
  return out;
}

/** The time range a month view asks the cloud about: its weeks, not past today. */
export function monthQueryRange({ year, month }, today) {
  const days = monthDays(year, month);
  const since = dayBounds(days[0].day).dayStart;
  const until = Math.min(dayBounds(days[days.length - 1].day).dayEnd, dayBounds(today).dayEnd);
  return { since, until };
}

/**
 * Which days of [since, until) the cloud holds rows on, newest first: ask for
 * the newest row before a cutoff, take its day, look before that day. Empty
 * days cost nothing; each answer also tells which days in between are empty.
 * `newestBefore(cutoff, since)` → the time of the newest row in [since,
 * cutoff), or null. `onStep({ found, checked })` reports each answer as it
 * comes (found: the day with rows or null; checked: the days now known).
 */
export async function walkCloudDays({ newestBefore, since, until, onStep, isCurrent = () => true }) {
  let cutoff = until;
  const found = [];
  while (cutoff > since) {
    const time = await newestBefore(cutoff, since);
    if (!isCurrent()) return found;
    if (time == null || !(time >= since) || !(time < cutoff)) {
      onStep?.({ found: null, checked: daysBetween(since, cutoff) });
      return found;
    }
    const day = dayKey(new Date(time));
    const { dayStart } = dayBounds(day);
    found.push(day);
    onStep?.({ found: day, checked: daysBetween(Math.max(dayStart, since), cutoff) });
    cutoff = dayStart;
  }
  return found;
}

// ---- downloading a day only the cloud holds ---------------------------------

/**
 * The panel while a day only the cloud held is being downloaded or was not
 * finished (H3c; 判定表「下載取消或失敗」): `download` is { day, status:
 * 'downloading' | 'failed' | 'cancelled' | 'done' }.
 */
export function downloadPanel(download, { day, hasRows, incomplete = false }) {
  // A day left incomplete earlier (another day was downloaded since) still says so.
  if ((!download || download.day !== day) && incomplete) download = { day, status: 'failed' };
  if (!download || download.day !== day || download.status === 'done') return null;
  if (download.status === 'downloading') {
    return { kind: 'downloading', title: t('c155', { date: shortDate(day) }), detail: t('c1253'),
      action: t('c046') };
  }
  // Cancelled or failed: what this phone holds, marked as incomplete; with
  // nothing at all, not H8 (it is not known to be empty).
  return hasRows ? { kind: 'incomplete', text: t("c686"), action: t('c049') }
    : { kind: 'unfinished', text: t('c321'), action: t('c049') };
}
