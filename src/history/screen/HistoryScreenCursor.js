import { t } from '../../i18n';
import { clock, listDuration } from '../HistoryText';
import { distanceText } from '../../utils/distanceText';
import { shownNumberAt, shownRowAt, shownStayDurationMs } from '../HistoryTimelinePresentation';
import { snapToRoute } from '../../mapHistory/CursorGeometry';
import { nearestRecord } from './HistoryScreenRange';
import { phoneDisplayLocations, phoneStayAtTime } from '../PhoneStayDisplayAnchors';

const MINUTE = 60000;

/**
 * The cursor's two lines (DESIGN.md「游標和標籤」, 2026-10-14): its time, then
 * the list row it is in, in the list's words — 「停留 2・28 分」 (an
 * unnumbered stay 「停留 28 分」), 「室內・25 分」, 「走路・已走 1.2 km」 (my
 * route), 「移動中・1.2 km」 (a dog), 「開車中」, 「坐車中」, or 「這段沒資料（最後
 * 10:29）」. The distance is the range's so far, as before.
 */
export function cursorLabel(model, time, subject = 'dog', gap = null) {
  if (gap) return [clock(time), t('c325', { time: clock(time) })];
  const row = Array.isArray(model.nodes) ? shownRowAt(model.nodes, time) : null;
  const listed = subject === 'phone' ? row : null;
  // A short break the list folded into a stay (beside it or inside it) is
  // that stay's time on the cursor too (2026-10-13).
  const listedStay = listed && (listed.terminalStay ?? listed.departureStay
    ?? (['stop', 'indoor'].includes(listed.type) ? listed : null));
  // The first fix of a movement row is also its stay's last one: the cursor
  // there (a tapped walk row) names the row it lit, as the list does (2026-10-15).
  const leaving = row?.type === 'movement' && time === row.start;
  const stay = leaving ? null : subject === 'phone'
    ? phoneStayAtTime(phoneDisplayLocations(model), time) || model.locations.find(n => n.type === 'indoor' && time >= n.start && time <= n.end)
      || listedStay
    : model.locations.find(n => ['stop', 'indoor'].includes(n.type) && time >= n.start && time <= n.end)
      || phoneStayAtTime(model.displayStays, time);
  // The stay's minutes as its list row shows them (a folded short break counts).
  // A stay's first minute is 「停留 不到 1 分」, never 「停留 0 分」, as the list's
  // 「停 不到 1 分」 (2026-10-15).
  const shownMs = stay && shownStayDurationMs(model.nodes, stay);
  const minutes = stay && (stay.type === 'stop' && Math.round(Math.max(0, shownMs || 0) / MINUTE) === 0
    ? t('c1276') : listDuration(shownMs));
  // The number the list shows for this stay (start / end stays have none).
  const number = stay?.type === 'stop' && row?.type === 'stop' ? shownNumberAt(model.nodes, time) : null;
  if (stay) return [clock(time), stay.type === 'indoor' ? t('c344', { duration: minutes })
    : number != null ? t('c1342', { number, duration: minutes }) : t('c136', { duration: minutes })];
  // At a switch boundary the outgoing segment owns the label.
  const section = model.sections.find(n => n.start <= time && n.end > time)
    || model.sections.find(n => n.end === time);
  if (['ride', 'driving'].includes(section?.mode)) return [clock(time), ((section.mode === 'ride') ? t('c1340') : t('c1341'))];
  const distance = (model.distanceEdges ?? model.sections).reduce((sum, n) => sum + (n.countedDistanceM || 0)
    * (time >= n.end ? 1 : time <= n.start ? 0 : (time - n.start) / (n.end - n.start)), 0);
  // One distance as everywhere (utils/distanceText): 「走路・已走 40 m」.
  return [clock(time), subject === 'phone' ? t('c1343', { distance: distanceText(distance) })
    : t('c1344', { distance: distanceText(distance) })];
}

export function screenCursor(model, time, { subject = 'dog', action = 'drag', previous = null } = {}) {
  // A break the list folded into the row beside it is that row's time, not
  // 「這段沒資料」 (2026-10-13); the map still draws it as a break.
  const gap = model.sections.find(n => n.type === 'gap' && time >= n.start && time < n.end
    && (subject !== 'phone' || !Array.isArray(model.nodes) || shownRowAt(model.nodes, time)?.type === 'gap'));
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

/** A presented timeline row's identity: its type and start. */
export const rowKey = row => (row ? `${row.type}:${row.start}` : null);

/**
 * The selected list row (2026-10-14): what the map and the list need of it —
 * its span (the map's emphasised segment), mode (the segment's glyph), type
 * and number (a solid stop marker), `key` (the list row) and where it was
 * chosen (`source`: 'map' drag / route tap, 'stop' number, 'list' tap; the
 * list scrolls to it for 'map' and 'stop').
 */
export function rowSelection(row, source = 'map') {
  if (!row) return null;
  return { key: rowKey(row), type: row.type, start: row.start, end: row.end, mode: row.mode ?? null,
    number: row.number ?? null, source, at: Date.now() };
}
