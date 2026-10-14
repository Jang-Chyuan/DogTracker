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

/**
 * The mismatches of a node list (historyTimeline's `nodes`), [] when every
 * total adds up: { at, kind, ... } with clock minutes only (no places).
 * Rows checked: stays, 室內, movements, and 出發 / end rows (they show no
 * minutes, so they must span none). A gap row says its own two clocks; rows
 * meet end to start.
 */
export function timelineClockMismatches(nodes) {
  const rows = timelinePresentation(nodes);
  const out = [];
  rows.forEach((row, i) => {
    const next = rows[i + 1];
    const timed = row.end > row.start;
    if (timed && next && next.start !== row.end && !(next.start === next.end && next.start === row.end)) {
      out.push({ at: i, kind: 'not-tiled', type: row.type, end: row.end, nextStart: next.start });
    }
    if (!timed || isGap(row)) return;
    const start = clockMinute(row.start), end = clockMinute(row.end);
    // A 出發 / end row shows no minutes (「出發」 only): it must take none.
    const moment = row.type === 'departure' || row.type === 'end';
    const minutes = moment ? 0 : shownMinutes(row), breaks = moment ? 0 : breakMinutes(row);
    if (start + minutes + breaks !== end) {
      out.push({ at: i, kind: 'sum', type: row.type, start, minutes, breaks, end });
    }
  });
  return out;
}

/** The leave chevron's departure clock of each stay row (what it shows). */
export function departureClocks(nodes) {
  const rows = timelinePresentation(nodes);
  return rows.map((row, i) => (['stop', 'indoor'].includes(row.type) && rows[i + 1]?.type === 'movement'
    ? { stay: clockMinute(row.end), next: clockMinute(rows[i + 1].start) } : null)).filter(Boolean);
}
