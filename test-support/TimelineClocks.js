// The list's time arithmetic, read the way a person reads the rows (2026-10-14,
// #163, the user asked for it): every row's start clock plus its shown
// minutes (and a stay's 「不含中斷 N 分」) is the next row's start clock, which
// is also the small departure time beside a stay's leave chevron. Clocks are
// HH:mm (the minute a moment falls in); minutes are what the row shows.
import { presentationDurationMs, timelinePresentation } from '../src/history/HistoryTimelinePresentation';

const MINUTE = 60000;
const clockMinute = time => Math.floor(time / MINUTE);
const shownMinutes = row => Math.round(Math.max(0, presentationDurationMs(row)) / MINUTE);
const breakMinutes = row => (row.type === 'stop' && row.interruptionMs > 0 ? Math.round(row.interruptionMs / MINUTE) : 0);
const isGap = row => row.type === 'gap';

// Rows that are a moment: 出發, 恢復記錄, the end, a 切換 point.
const MOMENTS = ['departure', 'resume', 'end', 'switch'];

/**
 * The mismatches of a node list (historyTimeline's `nodes`), [] when every
 * total adds up: { at, kind, ... } with clock minutes only (no places).
 * - 'not-tiled': rows meet end to start, a moment row too (2026-10-15: the
 *   seconds after a 恢復記錄 belonged to no row and nothing said so);
 * - 'moment-span': a 出發 / 恢復記錄 / end / 切換 row shows no minutes, so it
 *   spans none (2026-10-15: a still-confirming departure took a whole stay);
 * - 'sum': a stay, 室內, movement or my route's gap row's start clock + shown
 *   minutes (+ a stay's 「不含中斷 N 分」) is its end clock. A dog's gap row
 *   says its own two clocks.
 */
export function timelineClockMismatches(nodes) {
  const rows = timelinePresentation(nodes);
  const out = [];
  rows.forEach((row, i) => {
    const next = rows[i + 1];
    if (next && next.start !== row.end) {
      out.push({ at: i, kind: 'not-tiled', type: row.type, end: row.end, nextStart: next.start });
    }
    const moment = MOMENTS.includes(row.type);
    if (moment && row.end > row.start) out.push({ at: i, kind: 'moment-span', type: row.type, start: row.start, end: row.end });
    // 2026-10-15: my route's gaps show their minutes too (「沒有位置 19 分」);
    // a dog's keep their two clocks.
    if (!(row.end > row.start) || (isGap(row) && ['no-gps', 'no-signal'].includes(row.reason)) || moment) return;
    const start = clockMinute(row.start), end = clockMinute(row.end);
    const minutes = shownMinutes(row), breaks = breakMinutes(row);
    if (start + minutes + breaks !== end) {
      out.push({ at: i, kind: 'sum', type: row.type, start, minutes, breaks, end });
    }
  });
  return out;
}

/**
 * timelineClockMismatches, and whether the rows cover the model's range:
 * from its first fix to its last, every moment is in a row ('not-covered').
 * Rows may reach further (the day's 「沒有資料」 to midnight, a stay over
 * midnight from 00:00).
 */
export function timelineMismatches(model) {
  const out = timelineClockMismatches(model.nodes);
  const rows = timelinePresentation(model.nodes);
  const first = model.points?.[0], last = model.points?.[model.points.length - 1];
  if (first && rows.length && (rows[0].start > first.time || rows[rows.length - 1].end < last.time)) {
    out.push({ kind: 'not-covered', rowsStart: rows[0].start, rowsEnd: rows[rows.length - 1].end,
      firstFix: first.time, lastFix: last.time });
  }
  return out;
}

/** The leave chevron's departure clock of each stay row (what it shows). */
export function departureClocks(nodes) {
  const rows = timelinePresentation(nodes);
  return rows.map((row, i) => (['stop', 'indoor'].includes(row.type) && rows[i + 1]?.type === 'movement'
    ? { stay: clockMinute(row.end), next: clockMinute(rows[i + 1].start) } : null)).filter(Boolean);
}

/**
 * The metres the list's rows carry, added up (the summary must be this, so
 * no metres are lost): walking / moving rows and, on my route since
 * 2026-10-15 (#200), a stay's own moves, also when the list shows that stay
 * inside the start or end row. Since 2026-10-16 only 「在附近走動 …・200 m」
 * shows them; an ordinary stay's pill is 「停 25 分」, so the visible
 * distances need not add up to the summary.
 */
export function listedMetres(nodes) {
  const foot = row => row.type === 'movement' && (row.mode === 'walking' || row.mode === 'moving');
  return timelinePresentation(nodes).reduce((sum, row) => sum + (foot(row) || row.type === 'stop' ? row.countedDistanceM || 0 : 0)
    + (row.terminalStay?.countedDistanceM || 0) + (row.departureStay?.countedDistanceM || 0), 0);
}
