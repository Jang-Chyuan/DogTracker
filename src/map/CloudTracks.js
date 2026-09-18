import { simplifyRoute } from '../tracking/SimplifyRoute';
import { coordinate } from '../tracking/RouteSamples';

// A dog that stops reporting for this long has not walked the straight line
// between the two rows, so the line is broken there. Same rule as the history
// map, which has always had to answer the same question.
export const GAP_MS = 2 * 60 * 1000;
export const DISPLAY_BUDGET = 4000;

// Paths of several dogs at once need telling apart; the first is the familiar
// red of the single-dog map.
export const DOG_COLORS = Object.freeze(
  ['#E45756', '#8C5BD6', '#D9822B', '#2E9E7E', '#B4478F']);

export function dogColor(slaveId, index = 0) {
  const position = Number.isInteger(slaveId) ? slaveId : index;
  return DOG_COLORS[Math.abs(position) % DOG_COLORS.length];
}

/**
 * Downloaded rows to one drawable path per dog, clipped to the window the card
 * asks for. Simplified once, like every other route on the map, and capped so a
 * day of rows cannot flood the renderer.
 */
export function cloudTracks(rows = [], { since = 0, gapMs = GAP_MS, budget = DISPLAY_BUDGET } = {}) {
  const byDog = new Map();
  for (const row of rows) {
    const time = Number(row.received_at);
    if (!Number.isFinite(time) || time < since) continue;
    const point = coordinate(row.slave_lat, row.slave_lon);
    if (!point) continue;
    const slaveId = Number(row.slave_id);
    if (!byDog.has(slaveId)) byDog.set(slaveId, []);
    byDog.get(slaveId).push({ ...point, time });
  }
  const tracks = [];
  for (const [slaveId, points] of [...byDog.entries()].sort((a, b) => a[0] - b[0])) {
    const segments = [];
    let piece = [];
    let previous = null;
    for (const point of points) {
      if (previous && point.time - previous.time > gapMs) {
        if (piece.length > 1) segments.push(piece);
        piece = [];
      }
      piece.push(point);
      previous = point;
    }
    if (piece.length > 1) segments.push(piece);
    const simplified = segments.map(segment => simplifyRoute(segment, 1));
    let left = budget;
    const kept = [];
    for (let index = simplified.length - 1; index >= 0 && left > 0; index -= 1) {
      const part = simplified[index].slice(-left);
      if (part.length > 1) kept.unshift(part);
      left -= part.length;
    }
    if (kept.length) tracks.push({ slaveId, segments: kept });
  }
  return tracks;
}
