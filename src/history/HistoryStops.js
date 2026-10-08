import { configFor, distanceMeters, median, above } from './HistoryConfig';
import { isVehiclePoint } from './HistoryMovement';

/** One vote per visit; departure is confirmed only by consecutive outside fixes. */
export function historyVisits(points, { subject = 'dog', config = configFor(subject),
  vehicles = [], following = false } = {}) {
  const visits = [];
  let current = null, outside = [], insideIndex = 0;
  const finish = () => {
    if (!current) return;
    visits.push({ ...current, completed: true }); current = null; outside = [];
  };
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.heldReason || isVehiclePoint(p, vehicles)) { finish(); continue; }
    if (p.accuracy > config.stayAccuracyM) continue;
    if (current) {
      const prev = points[i - 1], dt = p.time - (prev?.time ?? p.time);
      if (dt > config.gapMs && (dt >= config.mergeGapMs || above(distanceMeters(prev.accuracy > config.stayAccuracyM
        ? current.points[current.points.length - 1] : prev, p), config.radiusM))) finish();
    }
    if (!current) {
      insideIndex = i;
      current = { id: `visit:${p.time}`, type: 'stop', start: p.time, end: p.time,
        latitude: p.latitude, longitude: p.longitude, points: [p], gaps: [], durationMs: 0, interruptionMs: 0 };
      continue;
    }
    if (!above(distanceMeters(current, p), config.radiusM)) {
      const last = current.points[current.points.length - 1];
      // All signal gaps are deducted, including gaps inside an unconfirmed exit.
      const gaps = points.slice(insideIndex + 1, i + 1);
      let previous = last, interrupted = 0;
      for (const q of gaps) {
        if (q.time - previous.time > config.gapMs) {
          interrupted += q.time - previous.time;
          current.gaps.push({ start: previous.time, end: q.time });
        }
        previous = q;
      }
      current.durationMs += p.time - last.time - interrupted;
      current.interruptionMs += interrupted;
      current.end = p.time; current.points.push(p); outside = []; insideIndex = i;
    } else {
      outside.push({ point: p, index: i });
      if (outside.length >= 2 && p.time - outside[0].point.time > config.leaveMs) {
        const restart = outside[0].index;
        finish(); i = restart - 1;
      }
    }
  }
  if (current) visits.push({ ...current, completed: !following });
  return visits;
}
function clippedVisit(visit, start, end, dayBoundary = false) {
  const inside = visit.points.filter(p => p.time >= start && p.time <= end);
  if (!inside.length) return null;
  const interruptionMs = visit.gaps.filter(g => g.start >= inside[0].time
    && g.end <= inside[inside.length - 1].time).reduce((sum, g) => sum + g.end - g.start, 0);
  return { ...visit, start: inside[0].time, end: inside[inside.length - 1].time,
    points: inside, interruptionMs,
    durationMs: inside[inside.length - 1].time - inside[0].time - interruptionMs,
    completed: visit.completed || visit.end > end,
    continuesPreviousDay: !!visit.continuesPreviousDay || (dayBoundary && visit.start < start),
    continuesNextDay: !!visit.continuesNextDay || (dayBoundary && visit.end > end) };
}
/** Stateless calculation plus an explicit immutable append state.
 * Caller changes `identity` for subject/source/range start/timezone/range kind.
 * Fixed ends belong in identity; following ends do not. Earlier edits or new
 * vehicle classification invalidate state automatically. */
export function historyStops(points, { start = -Infinity, end = Infinity,
  dayStart = start, dayEnd = end, subject = 'dog', config = configFor(subject),
  vehicles = [], following = false, identity = '', state = null } = {}) {
  const visits = historyVisits(points, { subject, config, vehicles, following });
  const day = visits.map(v => clippedVisit(v, dayStart, dayEnd, true)).filter(Boolean);
  const selected = day.map(v => clippedVisit(v, start, end)).filter(Boolean);
  const prefix = points.map(p => JSON.stringify(p));
  const vehicleKey = JSON.stringify(vehicles);
  const append = state?.identity === identity && state.vehicles.every(v => vehicles.some(next => next.start === v.start && next.end === v.end))
    && !vehicles.some(v => v.start <= state.lastTime && !state.vehicles.some(old => old.start === v.start && old.end === v.end))
    && state.prefix.every((p, i) => p === prefix[i]) && prefix.length >= state.prefix.length;
  const fallback = selected.length < config.minVisits || (append && !following && state.fallback);
  const baseline = fallback ? day : selected;
  const typicalMs = median(baseline.filter(v => v.completed).map(v => v.durationMs));
  const ready = baseline.length >= config.minVisits && typicalMs != null;
  const firstPass = !append || !state.ready || fallback !== state.fallback;
  const retained = new Set(append ? state.marked : []);
  const assessed = new Set(append ? state.assessed : []);
  for (const v of selected) {
    if (ready && (firstPass || !v.completed || !assessed.has(v.id))
      && v.durationMs >= config.stayMs && v.durationMs >= typicalMs * config.stayRatio) retained.add(v.id);
    if (ready && v.completed) assessed.add(v.id);
  }
  const stops = selected.filter(v => retained.has(v.id)).map((v, i) => ({ ...v, number: i + 1 }));
  return { visits: selected, stops, typicalMs, fallback,
    state: { identity, prefix, vehicleKey, vehicles: vehicles.map(v => ({ start: v.start, end: v.end })),
      lastTime: points[points.length - 1]?.time ?? -Infinity, ready, fallback,
      marked: [...retained], assessed: [...assessed] } };
}
/** Indoor holds are unconditional, unnumbered nodes, split at actual packet gaps.
 * Feed packet observations replayed with applyHistoryHolds / continueHistoryHolds.
 * Coordinates are the existing hold anchor; do not infer an address. */
export function historyIndoorNodes(points, { start = -Infinity, end = Infinity, dayStart = start, dayEnd = end,
  config = configFor('dog') } = {}) {
  const nodes = [];
  let node = null, previous = null;
  for (const p of points) {
    if (p.time < start || p.time > end) continue;
    if (!p.heldReason) { node = null; previous = p; continue; }
    if (!node || node.heldSince !== p.heldSince || p.time - previous.time > config.gapMs) {
      node = { type: 'indoor', start: p.time, end: p.time, durationMs: 0,
        latitude: p.latitude, longitude: p.longitude, reason: p.heldReason,
        heldSince: p.heldSince, label: '停留（室內）',
        continuesPreviousDay: p.heldSince < dayStart, continuesNextDay: false };
      nodes.push(node);
    } else { node.end = p.time; node.durationMs = node.end - node.start; }
    previous = p;
  }
  const after = points.find(p => p.time > dayEnd);
  if (after?.heldReason && nodes.length) {
    const last = nodes[nodes.length - 1];
    last.continuesNextDay = last.heldSince === after.heldSince && after.time - last.end <= config.gapMs;
  }
  return nodes;
}
