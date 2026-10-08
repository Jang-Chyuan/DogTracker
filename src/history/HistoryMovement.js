import { configFor, distanceMeters, atLeast } from './HistoryConfig';

/** Edges retain both actual distance and counted distance. Gaps never connect. */
export function historyMovement(points, { subject = 'dog', config = configFor(subject) } = {}) {
  const edges = points.slice(1).map((to, i) => {
    const from = points[i], durationMs = to.time - from.time;
    const distanceM = distanceMeters(from, to);
    return { from, to, start: from.time, end: to.time, durationMs, distanceM,
      speed: distanceM / (durationMs / 1000), gap: durationMs > config.gapMs,
      mode: from.heldReason && to.heldReason && from.heldSince === to.heldSince ? 'indoor' : subject === 'phone' ? 'walking' : 'moving' };
  });
  const vehicles = [];
  let high = null, active = null, low = null;
  const close = endIndex => {
    vehicles.push({ start: edges[active].start, end: edges[endIndex].end,
      firstEdge: active, lastEdge: endIndex });
    active = null; low = null; high = null;
  };
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (edge.gap || edge.mode === 'indoor') {
      if (active != null && (edge.mode === 'indoor' || edge.durationMs > config.maxVehicleGapMs
        || !atLeast(edge.speed, config.vehicleSpeed))) close(i - 1);
      high = null; low = null; continue;
    }
    if (active == null) {
      if (atLeast(edge.speed, config.vehicleSpeed)) {
        if (high == null) high = i;
        if (edge.end - edges[high].start >= config.enterMs) {
          active = high;
          if (config.backtrackSpeed != null) {
            while (active > 0 && !edges[active - 1].gap && edges[active - 1].mode !== 'indoor'
              && atLeast(edges[active - 1].speed, config.backtrackSpeed)) active -= 1;
          }
          high = null;
        }
      } else high = null;
    } else if (!atLeast(edge.speed, config.exitSpeed)) {
      if (low == null) low = i;
      if (edge.end - edges[low].start >= config.exitMs) close(low - 1);
    } else low = null;
  }
  if (active != null) close(edges.length - 1);
  for (const vehicle of vehicles) {
    for (let i = vehicle.firstEdge; i <= vehicle.lastEdge; i += 1) edges[i].mode = subject === 'phone' ? 'driving' : 'ride';
  }
  for (const edge of edges) {
    if (edge.gap) edge.mode = 'gap';
    edge.countedDistanceM = ['walking', 'moving'].includes(edge.mode)
      && atLeast(edge.distanceM, Math.max(edge.from.accuracy ?? 0, edge.to.accuracy ?? 0))
      ? edge.distanceM : 0;
  }
  const switches = edges.slice(1).flatMap((edge, i) => {
    const before = edges[i];
    return !['gap', 'indoor'].includes(edge.mode) && !['gap', 'indoor'].includes(before.mode)
      && edge.mode !== before.mode ? [{ type: 'switch', start: edge.start, end: edge.start,
        latitude: edge.from.latitude, longitude: edge.from.longitude, point: edge.from }] : [];
  });
  return { edges, vehicles, switches, pendingHighStart: high == null ? null : edges[high].start,
    distanceM: edges.reduce((sum, e) => sum + e.countedDistanceM, 0) };
}
export const isVehiclePoint = (point, vehicles) => vehicles.some(v => point.time >= v.start && point.time < v.end);
