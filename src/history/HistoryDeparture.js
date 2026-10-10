import { configFor, distanceMeters, atLeast, above } from './HistoryConfig';
import { historyMovement, isVehiclePoint } from './HistoryMovement';

// First index in `sorted` (ascending numbers) at or after `value`.
function lowerBound(sorted, value) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}
// First index in `items` (ascending by `key`) whose key is at or after `value`.
function firstFrom(items, key, value) {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (key(items[mid]) < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}
// 判定表「出發偵測怎麼找」: the fix within [lo, hi] closest to `target`, the
// earlier one on a tie. `times` are the candidates' times, ascending.
function nearest(candidates, times, target, lo, hi) {
  let best = null;
  for (let i = lowerBound(times, lo); i < times.length && times[i] <= hi; i += 1) {
    const p = candidates[i];
    if (!best || Math.abs(p.time - target) < Math.abs(best.time - target)) best = p;
  }
  return best;
}

/** Replays the full day's filtered observations: late-confirmed vehicles therefore
 * revoke overlapping confirmations without retaining a stale lock. Later trips
 * outside the first confirmation interval do not alter departure. */
export function historyDeparture(points, { subject = 'dog', config = configFor(subject),
  today = false, now = points[points.length - 1]?.time ?? 0,
  movement = historyMovement(points, { subject, config }), manualRange = null,
  // Candidates before this time are skipped: a caller that already knows
  // they all failed and cannot pass any more (TodayRouteEngine) saves the
  // whole day's search. The answer is the same.
  fromTime = -Infinity } = {}) {
  // Everything a candidate looks at lies ahead of it (and the fix before
  // it): with `fromTime`, only that part of the day is gone through.
  const base = fromTime > -Infinity ? Math.max(0, firstFrom(points, p => p.time, fromTime) - 1) : 0;
  const ahead = base ? points.slice(base) : points;
  const edges = base ? movement.edges.slice(firstFrom(movement.edges, e => e.start, points[base].time))
    : movement.edges;
  const candidates = ahead.filter(p => p.time >= fromTime && !p.heldReason && !p.phoneStationary && !isVehiclePoint(p, movement.vehicles));
  const times = candidates.map(p => p.time);
  const indexOf = new Map(ahead.map((p, i) => [p, i]));
  const edgeStarts = edges.map(e => e.start);
  const gaps = edges.filter(e => e.gap);
  const heldTimes = ahead.filter(p => p.heldReason).map(p => p.time);
  const finish = (status, candidate = null, start = points[0]?.time ?? null, decisionTime = null) => {
    const automaticRange = { start, end: points[points.length - 1]?.time ?? null };
    return { status, candidateTime: candidate?.time ?? null, decisionTime,
      automaticRange, range: manualRange ? { start: manualRange.start,
        end: manualRange.end ?? automaticRange.end } : automaticRange,
      manual: !!manualRange };
  };
  for (const candidate of candidates) {
    const t = candidate.time;
    const previous = ahead[indexOf.get(candidate) - 1];
    const adjacentVehicle = movement.vehicles.some(v => v.end === t);
    const start = !previous || adjacentVehicle || t - previous.time > config.gapMs || previous.heldReason ? t : previous.time;
    const elapsed = today ? now - t : Infinity;
    // Still waiting for the 3-minute point: nothing is announced yet.
    if (elapsed < 210000) continue;
    const three = nearest(candidates, times, t + 180000, t + 150000, t + 210000);
    if (!three) continue;
    const distance = distanceMeters(candidate, three), speed = distance / ((three.time - t) / 1000);
    if (!above(distance, 40) || !atLeast(speed, config.departureMinSpeed) || above(speed, config.departureMaxSpeed)) continue;
    let decisionTime = t + 480000;
    // Phone-only grace when a high-speed run at minute eight is unconfirmed.
    const at = lowerBound(edgeStarts, decisionTime) - 1;
    const atEight = at >= 0 && edges[at].end >= decisionTime ? edges[at] : null;
    const suspected = subject === 'phone' && atEight && !atEight.gap && atLeast(atEight.speed, config.vehicleSpeed);
    if (suspected) {
      let slowdown = null;
      for (let i = lowerBound(edgeStarts, decisionTime); i < edges.length; i += 1) {
        if (!atLeast(edges[i].speed, config.vehicleSpeed)) { slowdown = edges[i]; break; }
      }
      decisionTime = Math.min(t + 510000, slowdown?.end ?? Infinity);
      if (!today) decisionTime = Math.min(decisionTime, Math.max(t + 480000, now));
    }
    if (elapsed < decisionTime - t) return finish('confirming', candidate, start, decisionTime);
    const eight = nearest(candidates, times, t + 480000, t + 420000, t + 480000);
    const interrupted = gaps.some(e => e.start < t + 480000 && e.end > t);
    const transported = movement.vehicles.some(v => v.start <= decisionTime && v.end > start);
    const heldAt = lowerBound(heldTimes, t);
    const indoor = heldAt < heldTimes.length && heldTimes[heldAt] <= t + 480000;
    if (!eight || !above(distanceMeters(candidate, eight), 80) || interrupted || transported || indoor) continue;
    return finish('confirmed', candidate, start, decisionTime);
  }
  return finish(today ? 'not-departed' : 'undetermined');
}
