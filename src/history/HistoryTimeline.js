import { configFor } from './HistoryConfig';
import { historySourceStream, filterHistoryPoints, replayHistoryHolds } from './HistorySources';
import { historyMovement } from './HistoryMovement';
import { historyDeparture } from './HistoryDeparture';
import { historyStops, historyIndoorNodes } from './HistoryStops';

/** Pure H1/H2 list. `nodes` contains location rows AND movement/gap rows in
 * display order. No geocoding: address resolution can use location rows later.
 * Supply full-day observations (and <=24h hold/visit context for midnight).
 * Day bounds are [dayStart, dayEnd); range endpoints are actual observations.
 * Consumer calendar/list/export must use the returned source stream. */
export function historyTimeline(rows = [], options = {}) {
  const { subject = 'dog', source = 'all', dayStart = -Infinity, dayEnd = Infinity,
    today = false, now = rows[rows.length - 1]?.time ?? 0, manualRange = null,
    following = today && manualRange?.end == null, state = null, timezone = '',
    replayHolds, config = configFor(subject) } = options;
  const replay = replayHolds ?? (subject === 'dog'
    ? packets => replayHistoryHolds(packets, { since: dayStart, ...options.holdOptions }) : undefined);
  const stream = historySourceStream(rows, { source, replayHolds: replay });
  const context = filterHistoryPoints(stream.points, { subject, config });
  const dayPoints = context.filter(p => p.time >= dayStart && p.time < dayEnd);
  const contextMovement = historyMovement(context, { subject, config });
  const departure = historyDeparture(dayPoints, { subject, config, today, now, movement: contextMovement, manualRange });
  const range = options.range ?? departure.range;
  const points = dayPoints.filter(p => p.time >= range.start && p.time <= range.end);
  const movement = historyMovement(points, { subject, config });
  // Classify on the full day: clipping must not erase vehicle confirmation.
  const vehicles = contextMovement.vehicles;
  for (const e of movement.edges) {
    const vehicle = vehicles.some(v => e.start >= v.start && e.end <= v.end);
    if (vehicle && !e.gap) { e.mode = subject === 'phone' ? 'driving' : 'ride'; e.countedDistanceM = 0; }
  }
  const switches = movement.edges.slice(1).flatMap((e, i) => {
    const before = movement.edges[i];
    return e.mode !== before.mode && !['gap', 'indoor'].includes(e.mode)
      && !['gap', 'indoor'].includes(before.mode) ? [{ type: 'switch', start: e.start, end: e.start,
        latitude: e.from.latitude, longitude: e.from.longitude }] : [];
  });
  const identity = JSON.stringify([subject, source, range.start, following ? 'following' : range.end,
    dayStart, dayEnd, timezone, !!manualRange]);
  const stays = historyStops(context, { subject, config, start: range.start, end: range.end,
    dayStart, dayEnd: dayEnd - 1, vehicles, following, identity, state });
  const indoor = historyIndoorNodes(context, { start: Math.max(range.start, dayStart),
    end: Math.min(range.end, dayEnd - 1), dayStart, dayEnd: dayEnd - 1, config });
  const locations = [...stays.stops, ...indoor,
    ...switches.filter(s => !stays.stops.some(v => s.start >= v.start && s.start <= v.end))]
    .sort((a, b) => a.start - b.start);
  let number = 0;
  for (const node of locations) {
    if (node.type !== 'indoor') node.number = ++number;
  }
  const first = points[0], last = points[points.length - 1];
  if (first && !locations.some(n => n.start === first.time
    && (n.type === 'indoor' || (n.type === 'stop' && n.continuesPreviousDay)))) locations.unshift({ type: 'departure',
    start: first.time, end: first.time, latitude: first.latitude, longitude: first.longitude,
    manual: !!manualRange && manualRange.start !== departure.automaticRange.start,
    continuesPreviousDay: context.some(p => p.time < dayStart)
      && first.time - context.filter(p => p.time < dayStart).pop().time <= config.gapMs });
  if (last && last !== first && !locations.some(n => n.end === last.time && n.type === 'indoor')) locations.push({ type: 'end',
    start: last.time, end: last.time, latitude: last.latitude, longitude: last.longitude,
    label: following ? now - last.time <= 120000 ? '現在' : '最後' : '結束',
    continuesNextDay: context.some(p => p.time >= dayEnd && p.time - last.time <= config.gapMs) });
  const sections = [];
  for (const e of movement.edges) {
    if (e.mode !== 'gap' && locations.some(n => ['stop', 'indoor'].includes(n.type)
      && e.start >= n.start && e.end <= n.end)) continue;
    if (e.mode === 'indoor') continue;
    const prior = sections[sections.length - 1];
    if (prior && prior.mode === e.mode && prior.end === e.start && !locations.some(n => n.start === e.start || n.end === e.start)) {
      prior.end = e.end; prior.durationMs += e.durationMs;
      prior.distanceM += e.gap ? 0 : e.distanceM; prior.countedDistanceM += e.countedDistanceM;
    } else sections.push({ type: e.gap ? 'gap' : 'movement', mode: e.mode,
      start: e.start, end: e.end, durationMs: e.durationMs,
      latitude: e.from.latitude, longitude: e.from.longitude,
      endLatitude: e.to.latitude, endLongitude: e.to.longitude,
      distanceM: e.gap ? 0 : e.distanceM, countedDistanceM: e.countedDistanceM,
      excluded: ['driving', 'ride', 'gap'].includes(e.mode),
      line: e.gap ? 'long-dashed' : ['driving', 'ride'].includes(e.mode) ? 'solid' : 'dotted' });
  }
  const rank = node => node.type === 'departure' ? 0 : ['movement', 'gap'].includes(node.type) ? 2 : node.type === 'end' ? 3 : 1;
  const nodes = [...locations, ...sections].sort((a, b) => a.start - b.start || rank(a) - rank(b));
  return { ...stream, points, range, departure, nodes, locations, sections,
    state: stays.state, typicalMs: stays.typicalMs,
    distanceM: movement.edges.reduce((sum, e) => sum + e.countedDistanceM, 0),
    durationMs: first ? last.time - first.time : 0,
    hasGaps: movement.edges.some(e => e.gap), rangeEnabled: !!first && last.time - first.time >= 60000 };
}
