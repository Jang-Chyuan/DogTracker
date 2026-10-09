import { t } from '../../i18n';
import { clock, km, listDuration } from '../HistoryText';
import { snapToRoute } from '../../mapHistory/CursorGeometry';
import { nearestRecord } from './HistoryScreenRange';

export function cursorLabel(model, time, subject = 'dog', gap = null) {
  if (gap) return [clock(time), t('c325', { time: clock(time) })];
  const stay = model.locations.find(n => ['stop', 'indoor'].includes(n.type) && time >= n.start && time <= n.end);
  if (stay) return [clock(time), stay.type === 'indoor' ? t('c344', { duration: listDuration(stay.end - stay.start) })
    : t('c136', { duration: listDuration(stay.durationMs) })];
  // At a switch boundary the outgoing segment owns the label.
  const section = model.sections.find(n => n.start <= time && n.end > time)
    || model.sections.find(n => n.end === time);
  if (['ride', 'driving'].includes(section?.mode)) return [clock(time), ((section.mode === 'ride') ? t('c342') : t('c343'))];
  const distance = (model.distanceEdges ?? model.sections).reduce((sum, n) => sum + (n.countedDistanceM || 0)
    * (time >= n.end ? 1 : time <= n.start ? 0 : (time - n.start) / (n.end - n.start)), 0);
  return [clock(time), ((subject === 'phone') ? t('c131', { distance: km(distance) }) : t('c116', { distance: km(distance) }))];
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

const TEN_MINUTES = 600000;
const HOUR = 3600000;
const stayAt = (model, time) => (time == null ? null : (model.locations || [])
  .find(n => ['stop', 'indoor'].includes(n.type) && time >= n.start && time <= n.end) ?? null);

/**
 * The one haptic of a cursor move (判定表「操作與震動」): 'double' entering a
 * stay or for a node / stop number; 'heavy' reaching either end of the range;
 * 'click' crossing a full hour; 'tick' crossing a 10-minute mark (skipped
 * when a fast drag crosses several) or for a tap on the route; else null.
 */
export function cursorHaptic(model, previousTime, time, action = 'drag') {
  if (time == null) return null;
  if (action === 'node' || action === 'stop') return 'double';
  if (action === 'route') return 'tick';
  if (action !== 'drag' || previousTime == null || previousTime === time) return null;
  const stay = stayAt(model, time);
  if (stay && stay !== stayAt(model, previousTime)) return 'double';
  const points = model.points || [];
  const ends = [points[0]?.time, points[points.length - 1]?.time];
  if (ends.includes(time) && !ends.includes(previousTime)) return 'heavy';
  const low = Math.min(previousTime, time), high = Math.max(previousTime, time);
  if (Math.floor(high / HOUR) !== Math.floor(low / HOUR)) return 'click';
  const crossed = Math.floor(high / TEN_MINUTES) - Math.floor(low / TEN_MINUTES);
  return crossed === 1 ? 'tick' : null;
}
