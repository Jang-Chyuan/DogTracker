import { historyTimeline } from '../HistoryTimeline';
import { historyMovement } from '../HistoryMovement';
import { screenRange, reconcileRange } from './HistoryScreenRange';
import { screenCursor } from './HistoryScreenCursor';
import { protagonist, rangeOwner } from './HistoryScreenDogs';

/** Adapter reuses source filtering, departure/stay replay and vehicle detection.
 * Feed full-day rows plus midnight context exactly as for historyTimeline.
 * Cursor distance uses observation edges, never uniform speed across a list row. */
export function screenDayModel(rows, options) {
  const full = historyTimeline(rows, { ...options, manualRange: null,
    range: { start: options.dayStart, end: options.dayEnd - 1 } });
  const rangeOptions = { ...options, departure: full.departure };
  const range = options.reconcile ? reconcileRange(options.manual, full.points, rangeOptions)
    : screenRange(full.points, rangeOptions);
  const manualRange = range.manual ? { start: range.start, end: range.following ? null : range.end } : null;
  const timeline = historyTimeline(rows, { ...options, range: { start: range.start, end: range.lastRecord },
    manualRange, following: range.following });
  const vehicles = historyMovement(full.points, options).vehicles;
  const distanceEdges = historyMovement(timeline.points, { ...options, vehicles }).edges;
  return { ...timeline, screenRange: range, distanceEdges,
    cursor: screenCursor({ ...timeline, distanceEdges }, timeline.points[timeline.points.length - 1]?.time,
      { subject: options.subject, action: 'entry' }) };
}

/** Date changes select the protagonist BEFORE resolving shared remembered range.
 * models are computed for the selected source/day, including held packets.
 * Entry memory wins while that dog remains selected; otherwise main dog wins. */
export function changeDogDay(state, day, models, remembered = {}) {
  const dogs = state.dogs.map(d => ({ ...d, hasData: !!models[d.id]?.dayRecords }));
  const main = protagonist(dogs, state.protagonist);
  const owner = rangeOwner(dogs, state.entryId, main, remembered);
  const range = remembered[owner] ?? models[main]?.screenRange ?? null;
  const points = (models[main]?.points ?? []).filter(p => !range || (p.time >= range.start && p.time <= range.end));
  return { ...state, day, dogs, protagonist: main, range, cursorTime: points[points.length - 1]?.time ?? null,
    rangeExpanded: false, listPosition: 'start' };
}

export function sharedRecords(models) {
  return [...new Map(Object.values(models).flatMap(m => m.points).map(p => [p.time, p])).values()]
    .sort((a, b) => a.time - b.time);
}
