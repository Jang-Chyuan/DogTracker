import { t } from '../i18n';
import { configFor, distanceMeters } from './HistoryConfig';
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
  const { subject = 'dog', dayStart = -Infinity, dayEnd = Infinity,
    today = false, now = rows[rows.length - 1]?.time ?? 0, manualRange = null, closedAt = null,
    following = today && manualRange?.end == null, state = null, timezone = '',
    replayHolds, config = configFor(subject) } = options;
  const replay = replayHolds ?? (subject === 'dog'
    ? packets => replayHistoryHolds(packets, { since: dayStart, ...options.holdOptions }) : undefined);
  const stream = historySourceStream(rows, { replayHolds: replay });
  const context = filterHistoryPoints(stream.points, { subject, config });
  const dayPoints = context.filter(p => p.time >= dayStart && p.time < dayEnd);
  const contextMovement = historyMovement(context, { subject, config });
  const departure = historyDeparture(dayPoints, { subject, config, today, now, movement: contextMovement, manualRange });
  const range = options.range ?? departure.range;
  const points = dayPoints.filter(p => p.time >= range.start && p.time <= range.end);
  // Classify on the full day: clipping must not erase vehicle confirmation.
  const vehicles = contextMovement.vehicles;
  const movement = historyMovement(points, { subject, config, vehicles });
  const switches = movement.switches.map(({ point, ...node }) => node);
  const identity = JSON.stringify([subject, range.start, following ? 'following' : range.end,
    dayStart, dayEnd, timezone, !!manualRange]);
  const stays = historyStops(context, { subject, config, start: range.start, end: range.end,
    dayStart, dayEnd: dayEnd - 1, vehicles, following, identity, state });
  const held = historyIndoorNodes(context, { start: Math.max(range.start, dayStart),
    end: Math.min(range.end, dayEnd - 1), dayStart, dayEnd: dayEnd - 1, config });
  // 067: a hold the dog walked on out of (its next real fix more than
  // movedOnM from the hold spot) was no stay: the collar kept reporting
  // without GPS while the dog moved — 「收不到 GPS」, not 室內.
  const movedOn = held.filter(node => {
    const next = context.find(p => p.time > node.end && !p.heldReason);
    return next && config.movedOnM && distanceMeters(node, next) > config.movedOnM;
  });
  const indoor = held.filter(node => !movedOn.includes(node));
  const locations = [...stays.stops, ...indoor,
    ...switches.filter(s => !stays.stops.some(v => s.start >= v.start && s.start <= v.end))]
    .sort((a, b) => a.start - b.start);
  // 判定表「恢復記錄節點」: after a break of over 30 minutes the first fix
  // after it is a 恢復記錄 node (unless a stay or a hold already starts there).
  for (const e of movement.edges) {
    if (e.mode !== 'gap' || e.durationMs <= config.resumeAfterMs) continue;
    if (locations.some(n => n.start === e.end)) continue;
    locations.push({ type: 'resume', start: e.end, end: e.end, latitude: e.to.latitude, longitude: e.to.longitude });
  }
  locations.sort((a, b) => a.start - b.start);
  const first = points[0], last = points[points.length - 1];
  if (first && !locations.some(n => n.start === first.time
    && (n.type === 'indoor' || (n.type === 'stop' && n.continuesPreviousDay)))) locations.unshift({ type: 'departure',
    start: first.time, end: first.time, latitude: first.latitude, longitude: first.longitude,
    manual: !!manualRange && manualRange.start !== departure.automaticRange.start,
    continuesPreviousDay: context.some(p => p.time < dayStart)
      && first.time - context.filter(p => p.time < dayStart).pop().time <= config.gapMs });
  if (last && last !== first && !locations.some(n => n.end === last.time && n.type === 'indoor')) locations.push({ type: 'end',
    start: last.time, end: last.time, latitude: last.latitude, longitude: last.longitude,
    // 判定表「「現在」和「最後 12:05」」; a recording that was switched off
    // ends with 「記錄已關閉 10:20」 (closedAt, when the caller knows it).
    label: following ? now - last.time <= 120000 ? t('c130') : t("c660") : closedAt != null ? t("c656") : t('c330'),
    closedAt: following ? null : closedAt,
    continuesNextDay: context.some(p => p.time >= dayEnd && p.time - last.time <= config.gapMs) });
  const sections = [];
  // Moves inside a stay still count (判定表「距離怎麼算」: 和有沒有被標成停留
  // 無關): they go to the foot row that arrived there, or else the next one,
  // so the rows add up to the summary.
  let carried = 0;
  const isFoot = mode => mode === 'walking' || mode === 'moving';
  for (const e of movement.edges) {
    if (e.mode !== 'gap' && locations.some(n => ['stop', 'indoor'].includes(n.type)
      && e.start >= n.start && e.end <= n.end)) {
      const arrived = [...sections].reverse().find(row => row.type === 'movement');
      if (arrived && isFoot(arrived.mode)) arrived.countedDistanceM += e.countedDistanceM;
      else carried += e.countedDistanceM;
      continue;
    }
    if (e.mode === 'indoor') continue;
    const prior = sections[sections.length - 1];
    if (prior && prior.mode === e.mode && prior.end === e.start && !locations.some(n => n.start === e.start || n.end === e.start)) {
      prior.end = e.end; prior.durationMs += e.durationMs;
      prior.distanceM += e.gap ? 0 : e.distanceM; prior.countedDistanceM += e.countedDistanceM;
    } else sections.push({ type: e.gap ? 'gap' : 'movement', mode: e.mode,
      // 067: a dog's break says why — packets came without a fix
      // (「收不到 GPS」) or nothing came (「沒收到訊號」). A phone's stays
      // 「沒有資料」.
      ...(e.gap && subject === 'dog' ? { reason: stream.packets.some(p => p.time > e.start && p.time < e.end)
        ? 'no-gps' : 'no-signal' } : {}),
      start: e.start, end: e.end, durationMs: e.durationMs,
      latitude: e.from.latitude, longitude: e.from.longitude,
      endLatitude: e.to.latitude, endLongitude: e.to.longitude,
      distanceM: e.gap ? 0 : e.distanceM, countedDistanceM: e.countedDistanceM,
      excluded: ['driving', 'ride', 'gap'].includes(e.mode),
      line: e.gap ? 'long-dashed' : ['driving', 'ride'].includes(e.mode) ? 'solid' : 'dotted' });
    const row = sections[sections.length - 1];
    if (carried && isFoot(row.mode)) { row.countedDistanceM += carried; carried = 0; }
  }
  for (const node of movedOn) {
    sections.push({ type: 'gap', mode: 'gap', reason: 'no-gps', start: node.start, end: node.end,
      durationMs: node.end - node.start, latitude: node.latitude, longitude: node.longitude,
      endLatitude: node.latitude, endLongitude: node.longitude, distanceM: 0, countedDistanceM: 0,
      excluded: true, line: 'long-dashed' });
  }
  sections.sort((a, b) => a.start - b.start);
  const rank = node => node.type === 'departure' ? 0 : ['movement', 'gap'].includes(node.type) ? 2 : node.type === 'end' ? 3 : 1;
  let nodes = [...locations, ...sections].sort((a, b) => a.start - b.start || rank(a) - rank(b));
  // A switch right beside another place (a stay ends, the car starts after a
  // few seconds on foot) would leave a 0 km foot row between two points:
  // the place itself already separates the modes, so the switch and the empty
  // foot row go (H1: 停留 2 → 坐車 → 3).
  const foot = n => n?.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving');
  const place = n => n && !['movement', 'gap', 'switch'].includes(n.type);
  const drop = new Set();
  nodes.forEach((n, i) => {
    if (n.type !== 'switch') return;
    for (const [side, beyond] of [[nodes[i - 1], nodes[i - 2]], [nodes[i + 1], nodes[i + 2]]]) {
      if (foot(side) && side.countedDistanceM === 0 && side.durationMs <= 60000 && place(beyond) && !drop.has(beyond)) {
        drop.add(n); drop.add(side); return;
      }
    }
  });
  // Likewise a few seconds on foot with nothing counted between two places
  // (a stay, then the dog goes inside; a stay that runs into the end): the
  // places are adjacent (判定表「停在原處節點的前後」: 3 分鐘以內…停在原處
  // 節點不算移動段).
  nodes.forEach((n, i) => {
    if (foot(n) && n.countedDistanceM === 0 && n.durationMs <= 60000
      && place(nodes[i - 1]) && place(nodes[i + 1])) drop.add(n);
  });
  nodes = nodes.filter(n => !drop.has(n));
  // 判定表「交通方式切換點」: stays and switch points share one numbering in
  // time order; holds, departure, resume and end are not numbered.
  let number = 0;
  for (const node of nodes) {
    if (node.type === 'stop' || node.type === 'switch') node.number = ++number;
  }
  const keptLocations = locations.filter(n => !drop.has(n));
  const keptSections = sections.filter(n => !drop.has(n));
  // H8 asks whether the day itself has records; the context read before
  // midnight does not count (判定表「停住期間的封包算不算『有紀錄』」: held
  // packets do).
  const dayRecords = stream.packets.some(p => p.time >= dayStart && p.time < dayEnd);
  // dayPoints: the whole day's filtered fixes (the range bar snaps to them);
  // edges: the range's fix-to-fix steps (the history cursor's distance).
  return { ...stream, dayRecords, points, dayPoints, edges: movement.edges, range, departure, nodes,
    locations: keptLocations, sections: keptSections,
    state: stays.state, typicalMs: stays.typicalMs,
    distanceM: movement.edges.reduce((sum, e) => sum + e.countedDistanceM, 0),
    durationMs: first ? last.time - first.time : 0,
    hasGaps: movement.edges.some(e => e.gap), rangeEnabled: !!first && last.time - first.time >= 60000 };
}
