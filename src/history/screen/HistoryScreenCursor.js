import { clock, km, listDuration } from '../HistoryText';
import { snapToRoute } from '../../mapHistory/CursorGeometry';
import { nearestRecord } from './HistoryScreenRange';

export function cursorLabel(model, time, subject = 'dog', gap = null) {
  if (gap) return [clock(time), `這段沒資料（最後 ${clock(time)}）`];
  const stay = model.locations.find(n => ['stop', 'indoor'].includes(n.type) && time >= n.start && time <= n.end);
  if (stay) return [clock(time), stay.type === 'indoor' ? `室內・${listDuration(stay.end - stay.start)}`
    : `停留 ${listDuration(stay.durationMs)}`];
  // At a switch boundary the outgoing segment owns the label.
  const section = model.sections.find(n => n.start <= time && n.end > time)
    || model.sections.find(n => n.end === time);
  if (['ride', 'driving'].includes(section?.mode)) return [clock(time), `${section.mode === 'ride' ? '坐車' : '開車'}中・不算距離`];
  const distance = (model.distanceEdges ?? model.sections).reduce((sum, n) => sum + (n.countedDistanceM || 0)
    * (time >= n.end ? 1 : time <= n.start ? 0 : (time - n.start) / (n.end - n.start)), 0);
  return [clock(time), `${subject === 'phone' ? '已走' : '已移動'} ${km(distance)}`];
}

export function screenCursor(model, time, { subject = 'dog', action = 'drag', previous = null } = {}) {
  const gap = model.sections.find(n => n.type === 'gap' && time >= n.start && time < n.end);
  const shared = action === 'shared';
  const hidden = !model.points.length || (shared && time < model.points[0].time);
  const stale = shared && (gap || time > model.points[model.points.length - 1]?.time);
  const target = action === 'gap' || (shared && gap) ? gap?.start ?? time : time;
  const point = hidden ? null : nearestRecord(model.points, target);
  const selectedTime = shared ? time : point?.time ?? null;
  const label = point ? cursorLabel(model, point.time, subject, action === 'gap' || stale ? gap || {} : null) : null;
  const stay = point && model.locations.find(n => n.type === 'stop' && point.time >= n.start && point.time <= n.end);
  const previousStay = previous?.stayStart;
  const haptics = action === 'node' || (action === 'drag' && stay && stay.start !== previousStay) ? ['double']
    : action === 'route' ? ['tick'] : action === 'drag' && previous?.time != null
      && Math.floor(selectedTime / 600000) !== Math.floor(previous.time / 600000) ? ['tick'] : [];
  return { time: selectedTime, point, label, hidden, stale: !!stale || action === 'gap',
    stayStart: stay?.start ?? null, haptics };
}

/** Projected segments from mapHistory; spatial selection precedes temporal ties. */
export function routeCursorTime(segments, touch, currentTime, points) {
  const candidates = segments.map(segment => snapToRoute([segment], touch)).filter(Boolean);
  candidates.sort((a, b) => ((a.x - touch.x) ** 2 + (a.y - touch.y) ** 2)
    - ((b.x - touch.x) ** 2 + (b.y - touch.y) ** 2) || Math.abs(a.time - currentTime) - Math.abs(b.time - currentTime));
  const selected = candidates[0];
  return selected ? nearestRecord(points.filter(p => p.time >= selected.a.time && p.time <= selected.b.time), selected.time)?.time ?? null : null;
}

export function refreshCursor(model, cursor, options) {
  const oldLast = options.previousLast;
  return screenCursor(model, cursor?.time == null || cursor.time === oldLast
    ? model.points[model.points.length - 1]?.time : cursor.time, { ...options, action: 'refresh' });
}

export function selectCursorNode(model, node, options = {}) {
  return screenCursor(model, node.start, { ...options, action: node.type === 'gap' ? 'gap' : 'node' });
}
