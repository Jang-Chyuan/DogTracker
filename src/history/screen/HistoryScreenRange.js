import { historyDeparture } from '../HistoryDeparture';

export function nearestRecord(points, time) {
  return points.reduce((best, p) => !best || Math.abs(p.time - time) < Math.abs(best.time - time)
    || (Math.abs(p.time - time) === Math.abs(best.time - time) && p.time < best.time) ? p : best, null);
}

/** Input points are filtered full-day observations, ascending, UTC milliseconds.
 * end is the semantic endpoint; lastRecord is the snapped observation endpoint.
 * dayEnd is exclusive. No clock or persistence side effects. */
export function screenRange(points, { today = false, now, dayEnd = Infinity, closedAt = null,
  manual = null, departure = historyDeparture(points, { today, now }), expanded = false } = {}) {
  const first = points[0]?.time ?? null, last = points[points.length - 1]?.time ?? null;
  const following = today && closedAt == null && (!manual || manual.following);
  const end = following ? Math.min(now ?? last, dayEnd - 1) : (manual?.following ? last : manual?.end) ?? last;
  return { start: manual?.start ?? departure.automaticRange.start ?? first, end,
    lastRecord: following ? last : points.filter(p => p.time <= end).pop()?.time ?? null,
    following, manual: !!manual, expanded, enabled: first != null && last - first >= 60000,
    status: manual ? 'confirmed' : departure.status };
}

export function dragRange(range, points, handle, time, { rightEdge = range.end, today = false } = {}) {
  if (!range.enabled || !['start', 'end'].includes(handle)) return { range, haptics: [] };
  const point = nearestRecord(points, Math.round(time / 60000) * 60000);
  const following = handle === 'end' ? today && time >= rightEdge : range.following;
  const next = { ...range, manual: true, [handle]: point.time, following,
    lastRecord: handle === 'end' ? point.time : range.lastRecord };
  if (following) next.end = rightEdge;
  if ((next.lastRecord ?? next.end) - next.start < 60000) return { range, haptics: ['double'] };
  return { range: next, haptics: ['tick'] };
}

/** Only reconciliation may discard a remembered manual range (spec 369).
 * Start rounds inward to its minute or later; fixed end rounds inward earlier. */
export function reconcileRange(manual, points, options) {
  if (!manual) return screenRange(points, options);
  const start = points.find(p => p.time >= Math.floor(manual.start / 60000) * 60000)?.time;
  const end = manual.following ? points[points.length - 1]?.time
    : points.filter(p => p.time <= Math.floor(manual.end / 60000) * 60000 + 59999).pop()?.time;
  return screenRange(points, { ...options, manual: start != null && end - start >= 60000
    ? { start, end, following: manual.following } : null });
}

export function rangeBar(range, action) {
  if (action === 'summary') return { ...range, expanded: !range.expanded };
  if (['done', 'map-blank', 'list', 'panel-drag', 'back'].includes(action)) return { ...range, expanded: false };
  return range;
}

/** Persistence key belongs to the entry subject, never the changing protagonist. */
export function rangeMemoryKey(entryId, day, source, timezone) {
  return JSON.stringify([entryId, day, source, timezone]);
}

export function rememberRange(memory, key, range) {
  if (!range.manual) {
    const next = { ...memory };
    delete next[key];
    return next;
  }
  return { ...memory, [key]: { start: range.start, end: range.end, following: range.following } };
}
