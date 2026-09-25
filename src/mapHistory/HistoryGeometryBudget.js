import { projectRoutePoint, squaredSegmentDistance } from '../tracking/SimplifyRoute';

// Native overlay count matters as much as vertex count. Never bridge omitted gaps.
export const HISTORY_SEGMENT_LIMIT = 120;
export const HISTORY_VERTEX_LIMIT = 4000;

export function groupHistoryStreams(points) {
  const streams = new Map();
  for (const point of points) {
    const key = JSON.stringify([point.master_id ?? null, point.slave_id ?? null, point.session_id ?? null]);
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(point);
  }
  return [...streams.values()];
}

function allocate(needs, budget) {
  const counts = needs.map(() => 0);
  while (budget > 0) {
    let used = 0;
    needs.forEach((need, i) => {
      if (budget && counts[i] < need) { counts[i]++; budget--; used++; }
    });
    if (!used) break;
  }
  return counts;
}

// Choose distinct segments across the entire time range, retaining both ends.
function spreadSegments(parts, count) {
  if (parts.length <= count) return parts;
  if (!count) return [];
  if (count === 1) return [parts[parts.length - 1]];
  const result = [parts[0]];
  const from = parts[0][0].time, to = parts[parts.length - 1][0].time;
  let previous = 0;
  for (let i = 1; i < count - 1; i++) {
    const target = from + (to - from) * i / (count - 1);
    const maximum = parts.length - (count - i);
    let index = previous + 1;
    while (index < maximum && Math.abs(parts[index + 1][0].time - target) < Math.abs(parts[index][0].time - target)) index++;
    result.push(parts[index]); previous = index;
  }
  result.push(parts[parts.length - 1]);
  return result;
}

// Allocate one representative turn per chronological bucket. Each comparison
// uses the input geometry, never a repeatedly simplified intermediate result.
// This is linear in input size and cannot stall JS on a noisy zigzag track.
export function simplifyToBudget(points, count) {
  if (points.length <= count) return points;
  const output = [points[0]];
  const buckets = count - 2;
  for (let i = 0; i < buckets; i++) {
    const start = 1 + Math.floor(i * (points.length - 2) / buckets);
    const end = 1 + Math.floor((i + 1) * (points.length - 2) / buckets);
    const a = projectRoutePoint(points[start - 1]);
    const b = projectRoutePoint(points[end]);
    let best = start, distance = -1;
    for (let j = start; j < end; j++) {
      const value = squaredSegmentDistance(projectRoutePoint(points[j]), a, b);
      if (value > distance) { best = j; distance = value; }
    }
    output.push(points[best]);
  }
  output.push(points[points.length - 1]);
  return output;
}

export function budgetHistoryTracks(tracks) {
  const parts = tracks.map(track => track.segments.filter(part => part.length)
    .slice().sort((a, b) => a[0].time - b[0].time));
  const slots = allocate(parts.map(part => part.length), HISTORY_SEGMENT_LIMIT);
  const selected = parts.map((part, i) => spreadSegments(part, slots[i]));
  const minimum = selected.map(track => track.reduce((sum, part) => sum + Math.min(2, part.length), 0));
  const extra = allocate(selected.map((track, i) => track.reduce((sum, part) => sum + part.length, 0) - minimum[i]),
    HISTORY_VERTEX_LIMIT - minimum.reduce((a, b) => a + b, 0));
  return tracks.map((track, i) => {
    const detail = allocate(selected[i].map(part => Math.max(0, part.length - 2)), extra[i]);
    const segments = selected[i].map((part, j) => simplifyToBudget(part, Math.min(2, part.length) + detail[j]));
    return { ...track, segments,
      limited: track.limited || segments.reduce((n, part) => n + part.length, 0)
        < parts[i].reduce((n, part) => n + part.length, 0) };
  });
}

export function budgetHistory(data) {
  const [phone, ...clients] = budgetHistoryTracks([data.phone, ...data.clients]);
  return { ...data, phone, clients };
}
