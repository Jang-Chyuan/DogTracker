import { accuracyOf, configFor, distanceMeters, atLeast, above } from './HistoryConfig';
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
 * revoke overlapping confirmations without retaining a stale lock — except a
 * walk that led into the vehicle, which the vehicle confirms (leaving by car
 * is the departure). The day's first vehicle no walking departure came
 * before is itself the departure. Later trips outside the first confirmation
 * interval do not alter departure. */
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
  // 判定表「出發偵測怎麼找」(2026-10 user): leaving by car (a dog by ride)
  // is a departure too. Like a walk's minute-eight fix, the ride's last fix
  // within its first eight minutes (or its end) must be over 80 m from
  // `from`: a real trip keeps going, a "ride" made of GPS drift jumping
  // about one place comes back. A ride that is not that far proves nothing.
  const carriedAway = (from, ride) => {
    const last = ahead[firstFrom(ahead, p => p.time, Math.min(ride.end, ride.start + 480000) + 1) - 1];
    return last && last.time >= ride.start && above(distanceMeters(from, last), 80) ? last : null;
  };
  const rides = movement.vehicles.filter(v => v.end >= (ahead[0]?.time ?? Infinity) && v.start >= fromTime);
  let nextRide = 0;
  // A ride no walking departure came before: the departure is where it set
  // off (its first fix in the day; the fix before, as for a candidate).
  const rideDeparture = ride => {
    const at = firstFrom(ahead, p => p.time, ride.start);
    const first = ahead[at];
    if (!first || first.time > ride.end) return null;
    const previous = ahead[at - 1];
    const start = !previous || first.time - previous.time > config.gapMs || previous.heldReason ? first.time : previous.time;
    const away = carriedAway(first, ride);
    return away ? finish('confirmed', first, start, away.time) : null;
  };
  // 2026-10-15 (#200, phone, a stop-and-go dog walk): the walk began where
  // the phone last stayed. Going back from where the passing candidate set
  // off (`index` in `points`), stretches standing still (measured still, or
  // within the GPS jitter of their last fix, as `stood` below) shorter than
  // stayMs are stops of the walk (the dog sniffing; no stay in the list
  // either); the first stretch of stayMs is the stay the walk left, and the
  // departure is its last fix. Never across a break, an indoor hold or a
  // vehicle, nor more than departureWalkBackMs back (then: the earliest fix
  // reached on the move, or the last of the stretch it stood in). The candidate that passes can be minutes into the walk when
  // the first ones' minute three or eight fell on a stop.
  const walkedFrom = index => {
    if (!config.departureWalkBackMs) return null;
    const from = points[index];
    let last = points[index], reached = from.time, standing = false;
    for (let j = index - 1; j >= 0; j -= 1) {
      const p = points[j];
      if (from.time - p.time > config.departureWalkBackMs || p.heldReason
        || points[j + 1].time - p.time > config.gapMs || isVehiclePoint(p, movement.vehicles)) break;
      standing = (p.phoneStationary && last.phoneStationary) || !above(distanceMeters(last, p),
        Math.max(2 * config.minMoveM, accuracyOf(last, config), accuracyOf(p, config)));
      if (!standing) last = p;
      else if (last.time - p.time >= config.stayMs) return last.time;
      reached = p.time;
    }
    // Stopped going back while standing: the walk began where that ended.
    return standing ? last.time : reached;
  };
  for (const candidate of candidates) {
    const t = candidate.time;
    while (nextRide < rides.length && rides[nextRide].start < t) {
      const found = rideDeparture(rides[nextRide]);
      nextRide += 1;
      if (found) return found;
    }
    const previous = ahead[indexOf.get(candidate) - 1];
    const adjacentVehicle = movement.vehicles.some(v => v.end === t);
    const elapsed = today ? now - t : Infinity;
    // Still waiting for the 3-minute point: nothing is announced yet.
    if (elapsed < 210000) continue;
    const three = nearest(candidates, times, t + 180000, t + 150000, t + 210000);
    if (!three) continue;
    const distance = distanceMeters(candidate, three), speed = distance / ((three.time - t) / 1000);
    // 2026-10-15 (#200, a lift at home): the phone's 40 m must lie beyond
    // both fixes' accuracy. In a lift the phone reports coarse fast fixes
    // (25–50 m) 60–90 m from the flat, and that passed as three minutes on
    // foot: a confirming departure for five minutes until minute eight.
    const margin = config.departureBeyondAccuracy ? accuracyOf(candidate, config) + accuracyOf(three, config) : 0;
    if (!above(distance - margin, 40) || !atLeast(speed, config.departureMinSpeed) || above(speed, config.departureMaxSpeed)) continue;
    // 2026-10-13: the three-minute window lets a brisk walk qualify a
    // candidate still standing at the stay up to three minutes before it set
    // off (stay from 07:00, walk 07:12, 出發 07:09). When the fixes after the
    // candidate stay on its spot for a minute or more, the departure is the
    // last of them: where the walk began (DESIGN 出發在走路的起點).
    // Standing: within the GPS jitter of a still fix (twice minMoveM, or the
    // fixes' accuracy); the walk began at the last of them within minMoveM.
    const first = indexOf.get(candidate);
    let stood = first;
    while (ahead[stood + 1] && ahead[stood + 1].time < three.time && !ahead[stood + 1].heldReason
      && !above(distanceMeters(candidate, ahead[stood + 1]), Math.max(2 * config.minMoveM,
        accuracyOf(candidate, config), accuracyOf(ahead[stood + 1], config)))) stood += 1;
    while (stood > first && above(distanceMeters(candidate, ahead[stood]), config.minMoveM)) stood -= 1;
    const setOff = ahead[stood].time - t >= 60000 ? ahead[stood].time : null;
    const plain = !previous || adjacentVehicle || t - previous.time > config.gapMs || previous.heldReason
      ? t : previous.time;
    const start = Math.min(setOff ?? plain, walkedFrom(base + (setOff != null ? stood : first)) ?? Infinity);
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
    // The walk (three minutes on foot) led into a ride before the decision:
    // that is the departure, not the walk after the ride. Nothing may break
    // the walk before the ride starts.
    const ride = movement.vehicles.find(v => v.start > t && v.start <= decisionTime);
    if (ride && !gaps.some(e => e.start < ride.start && e.end > t)) {
      const heldAt = lowerBound(heldTimes, t);
      const away = !(heldAt < heldTimes.length && heldTimes[heldAt] <= ride.start) && carriedAway(candidate, ride);
      if (away) return finish('confirmed', candidate, start, Math.max(t + 210000, away.time));
    }
    if (elapsed < decisionTime - t) return finish('confirming', candidate, start, decisionTime);
    const eight = nearest(candidates, times, t + 480000, t + 420000, t + 480000);
    const interrupted = gaps.some(e => e.start < t + 480000 && e.end > t);
    const transported = movement.vehicles.some(v => v.start <= decisionTime && v.end > start);
    const heldAt = lowerBound(heldTimes, t);
    const indoor = heldAt < heldTimes.length && heldTimes[heldAt] <= t + 480000;
    // Phone (with the walk-back): at minute eight also over 80 m from where
    // the walk left (`start`): a candidate late in a walk out and back home
    // is that far from home, but the phone came back.
    const origin = config.departureWalkBackMs ? points[firstFrom(points, p => p.time, start)] : null;
    if (!eight || !above(distanceMeters(candidate, eight), 80) || (origin && !above(distanceMeters(origin, eight), 80))
      || interrupted || transported || indoor) continue;
    return finish('confirmed', candidate, start, decisionTime);
  }
  for (; nextRide < rides.length; nextRide += 1) {
    const found = rideDeparture(rides[nextRide]);
    if (found) return found;
  }
  return finish(today ? 'not-departed' : 'undetermined');
}
