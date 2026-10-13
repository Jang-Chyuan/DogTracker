// Raw phone evidence. Coordinates are preserved separately from the display lock.
const dist = (a, b) => {
  const r = Math.PI / 180,
    h =
      Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 +
      Math.cos(a.latitude * r) *
        Math.cos(b.latitude * r) *
        Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
};
// An explicit missing raw speed must survive a pipeline's display speed zero.
const rawPhoneSpeed = p => p.raw_speed_kmh === undefined ? p.speed_kmh : p.raw_speed_kmh;
// How far a still-speed fix may sit from the locked anchor and still keep the
// stop: half again the larger accuracy, at least the 25 m place radius.
const coarseHoldRadius = (anchor, p) => Math.max(25, 1.5 * Math.max(anchor.accuracy, p.accuracy));
// A fix whose position or accuracy cannot be geometric evidence.
const unusable = q => !Number.isFinite(q.accuracy) || q.accuracy < 0 || q.accuracy >= 50
  || !Number.isFinite(q.latitude) || !Number.isFinite(q.longitude)
  || Math.abs(q.latitude) > 90 || Math.abs(q.longitude) > 180;
// steps[i] is dist(list[i - 1], list[i]); steps[0] is never read.
const stepsOf = list => list.map((q, i) => (i ? dist(list[i - 1], q) : 0));
const increasing = list => list.every((q, i) => Number.isFinite(q.time) && (!i || q.time > list[i - 1].time));

// Performance contract (decisions are those of the plain filter/map/reduce
// version, test-support/PhoneMotionReference.js, bit for bit):
// - A sample's distance to its neighbour is computed once, when it joins
//   `tail` or `entry` (`tailSteps` / `entrySteps`), not on every window.
// - While `tail` holds strictly increasing finite times (always, for the
//   history and live callers) each "the last W ms" window is a suffix found by
//   binary search, and each 30 s departure slice a contiguous run.
//   Otherwise (`tailOrdered` false) the window is filtered like before.
// - Sums still add each window's steps from its first fix in time order, so
//   no running total (whose rounding would differ) can flip a threshold.
// Samples must not be mutated after `accept`: their distances are cached.
export class PhoneMotion {
  constructor() {
    this.tail = [];
    this.entry = [];
    this.state = 'moving';
    this.anchor = null;
    this.lowAt = 0;
    this.highAt = null;
    this.last = 0;
    this.strictReentry = false;
    this.departureSince = null;
    this.lastGeometryAt = 0;
    this.origin = null;
    this.movingProof = false;
    this.unconfirmedSince = null;
    this.tailSteps = [];
    this.tailOrdered = true;
    this.entrySteps = [];
    this.entryOrdered = true;
  }
  reset() {
    this.setTail([], [], true);
    this.clearEntry();
    this.state = 'moving';
    this.anchor = null;
    this.highAt = null;
    this.lowAt = 0;
    this.strictReentry = false;
    this.origin = null;
    this.lastGeometryAt = 0;
    this.movingProof = false;
    this.unconfirmedSince = null;
  }
  setTail(tail, steps = stepsOf(tail), ordered = increasing(tail)) {
    this.tail = tail;
    this.tailSteps = steps;
    this.tailOrdered = ordered;
  }
  clearEntry() {
    this.entry = [];
    this.entrySteps = [];
    this.entryOrdered = true;
  }
  confirmDeparture(since) {
    this.reset();
    this.strictReentry = true;
    this.departureSince = since;
    this.movingProof = true;
    return 'moving';
  }
  continueMoving(p) {
    // Continuing an already released trajectory must not repeatedly rewind
    // the entire day. Restore only a meaningful newly unconfirmed suffix.
    if (this.unconfirmedSince != null && p.time - this.unconfirmedSince >= 15000)
      this.departureSince = Math.max(this.unconfirmedSince, this.tail[0].time);
    this.unconfirmedSince = null;
    this.clearEntry();
    this.state = 'moving';
    this.movingProof = true;
    return this.state;
  }
  // The `tail` fixes with p.time - q.time <= width, as list[lo..] with steps.
  window(p, width) {
    const list = this.tail;
    if (this.tailOrdered && Number.isFinite(p.time)) {
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (p.time - list[mid].time <= width) hi = mid;
        else lo = mid + 1;
      }
      return { list, steps: this.tailSteps, lo, ordered: true };
    }
    const kept = list.filter(q => p.time - q.time <= width);
    return { list: kept, steps: stepsOf(kept), lo: 0, ordered: increasing(kept) };
  }
  // Whether list[lo..] (ending at p) is sustained physical progress.
  progress(p, list, steps, lo = 0, qualityAware = false) {
    const end = list.length;
    if (end - lo < 3 || p.time - list[lo].time < 15000) return false;
    for (let i = lo; i < end; i += 1) if (unusable(list[i])) return false;
    let threshold = 3;
    if (qualityAware) for (let i = lo; i < end; i += 1) threshold = Math.max(threshold, list[i].accuracy * 2);
    const net = dist(list[lo], p);
    if (!(net > threshold + 1e-8)) return false;
    let path = 0, longest = -Infinity;
    for (let i = lo + 1; i < end; i += 1) {
      path += steps[i];
      longest = Math.max(longest, steps[i]);
    }
    return net / path > (qualityAware ? 0.85 : 0.75) && longest < net * 0.5;
  }
  movementStart() {
    // Search backwards for the most recent compact plateau in one pass.
    // A genuine walk cannot move the origin back into an older offset jump.
    let end = this.tail.at(-1),
      count = 1;
    for (let i = this.tail.length - 2; i >= 0; i -= 1) {
      const point = this.tail[i];
      if (dist(point, end) <= 3) {
        count += 1;
        if (count >= 3 && end.time - point.time >= 25000) return end.time;
      } else {
        end = point;
        count = 1;
      }
    }
    return this.tail[0].time;
  }
  // Keeps one sample per second; returns whether times still strictly increase.
  pushSample(list, steps, point) {
    this.origin ??= point.time;
    const bucket = value => Math.floor((value.time - this.origin) / 1000);
    if (list.length && bucket(list.at(-1)) === bucket(point))
      list[list.length - 1] = point;
    else list.push(point);
    const n = list.length;
    steps[n - 1] = n > 1 ? dist(list[n - 2], point) : 0;
    return Number.isFinite(point.time) && (n < 2 || point.time > list[n - 2].time);
  }
  accept(p) {
    this.departureSince = null;
    if (this.last && (p.time <= this.last || p.time - this.last > 30000)) this.reset();
    this.last = p.time;
    if (!this.pushSample(this.tail, this.tailSteps, p)) this.tailOrdered = false;
    if (this.tailOrdered) {
      // Only the oldest fixes can have left the 10-minute window.
      let drop = 0;
      while (drop < this.tail.length && !(p.time - this.tail[drop].time <= 600000)) drop += 1;
      drop = Math.max(drop, this.tail.length - 720);
      if (drop > 0) {
        this.tail.splice(0, drop);
        this.tailSteps.splice(0, drop);
      }
    } else this.setTail(this.tail.filter(q => p.time - q.time <= 600000).slice(-720));
    // Strict reentry is a safety policy, not perpetual physical-motion proof.
    this.movingProof = false;
    const speed = rawPhoneSpeed(p) == null ? null : rawPhoneSpeed(p) / 3.6,
      sacc = p.speed_accuracy_mps;
    const valid =
      Number.isFinite(p.accuracy) &&
      p.accuracy >= 0 &&
      p.accuracy < 50 &&
      speed != null &&
      speed >= 0 &&
      Number.isFinite(speed);
    const spread = Number.isFinite(sacc) && sacc >= 0;
    const speedGood =
      valid &&
      p.accuracy <= 30 &&
      speed <= 1 &&
      (spread
        ? sacc <= 1.5 && speed - sacc <= 0.500001
        : p.accuracy <= 10 && speed <= 0.3);
    const high = valid && (spread ? speed - sacc > 0.500001 : speed > 1);
    // Coarse (30–50 m) fixes cannot confirm a stop, but one measuring the
    // phone still (≤ 0.3 m/s) near the locked anchor keeps it: indoors a still
    // phone often has only Wi-Fi fixes. Leaving needs sustained distance
    // beyond this radius (the 3-minute expiry below), speed evidence, or the
    // geometric departure. A slow walk's 0.5–1 m/s reading never keeps it.
    const still = valid && speed <= 0.3 && (!spread || sacc <= 1.5);
    // Reliable measured walking already has finite speed credit. Reserve the
    // extra geometry pass for absent/contradictory/uncertain speed evidence.
    if (this.strictReentry && (!valid || speed < 0.3 || (spread && sacc > 1.5 && !high)
      || (!spread && p.accuracy > 10 && speed <= 1))) {
      const minute = this.window(p, 60000);
      this.movingProof = this.progress(p, minute.list, minute.steps, minute.lo, true);
    }
    if (speedGood) this.lowAt = p.time;
    if (this.state === 'stationary') {
      if (high) {
        this.highAt ??= p.time;
        if (p.time - this.highAt >= 3000) {
          return this.confirmDeparture(this.highAt);
        }
        return this.state;
      } else this.highAt = null;
      const geometric =
        p.time - this.lastGeometryAt >= 5000 && this.departure(p);
      if (p.time - this.lastGeometryAt >= 5000) this.lastGeometryAt = p.time;
      if (geometric) return this.confirmDeparture(this.movementStart());
      if (!speedGood && still && this.anchor && dist(this.anchor, p) <= coarseHoldRadius(this.anchor, p))
        this.lowAt = p.time;
      if (!speedGood && p.time - this.lowAt > 180000) {
        this.reset();
        return 'unknown';
      }
      return this.state;
    }
    if (!speedGood) {
      this.clearEntry();
      if (this.strictReentry && this.movingProof) return this.continueMoving(p);
      // Unknown speed is not walking proof. Retain a bounded raw window so
      // sustained physical progress can confirm movement without a speed.
      const check = p.time - this.lastGeometryAt >= 5000;
      if (check) this.lastGeometryAt = p.time;
      if (!high && check && this.departure(p))
        return this.strictReentry ? this.continueMoving(p) : this.confirmDeparture(this.movementStart());
      this.state = high ? 'moving' : 'unknown';
      if (high) this.unconfirmedSince = null;
      else this.unconfirmedSince ??= p.time;
      return high ? 'moving' : 'unknown';
    }
    const entry = this.entry, entrySteps = this.entrySteps;
    if (!this.pushSample(entry, entrySteps, p)) this.entryOrdered = false;
    while (entry.length > 1 && p.time - entry[1].time >= 20000) {
      entry.shift();
      entrySteps.shift();
    }
    const first = entry[0],
      net = dist(first, p);
    let path = 0;
    for (let i = 1; i < entry.length; i += 1) path += entrySteps[i];
    const fine = entry.every(q => q.accuracy <= 10);
    let threshold = 3;
    if (!fine) {
      const scale = this.strictReentry ? 2 : 1;
      threshold = 5;
      for (const q of entry) threshold = Math.max(threshold, q.accuracy * scale);
    }
    const reentryProgress = this.strictReentry && this.progress(p, entry, entrySteps);
    // A 3m guard only rejects reentry. Backfilling further travel still needs
    // the original long, quality-aware proof, plus current progress.
    if (reentryProgress && p.time - this.lastGeometryAt >= 5000) {
      this.lastGeometryAt = p.time;
      if (this.departure(p)) return this.continueMoving(p);
    }
    if (
      entry.some(q => dist(first, q) > threshold) ||
      (fine && net > 3 && net / path > 0.75) || reentryProgress
    ) {
      this.clearEntry();
      if (!this.strictReentry) this.setTail([], [], true);
      this.state = 'moving';
      return 'moving';
    }
    const elapsed = p.time - first.time;
    this.state =
      elapsed >= 20000
        ? 'stationary'
        : elapsed >= 15000
        ? 'suspected_stationary'
        : 'moving';
    if (this.state === 'stationary') {
      this.anchor = p;
      this.strictReentry = false;
      this.unconfirmedSince = null;
      // A new confirmed stop starts a new departure window. The preceding
      // genuine walk cannot be reused to release this stationary anchor.
      this.setTail(entry.slice(), entrySteps.slice(), this.entryOrdered);
    } else if (!this.strictReentry) this.setTail(entry.slice(), entrySteps.slice(), this.entryOrdered);
    return this.state;
  }
  departure(p) {
    const recent = this.window(p, 20000);
    let fine = true;
    for (let i = recent.lo; i < recent.list.length; i += 1)
      if (!(recent.list[i].accuracy <= 10)) {
        fine = false;
        break;
      }
    // The wider windows contain the narrower ones (suffixes of the same
    // ordered tail), so the largest accuracy and any unusable fix are
    // extended downwards from the last window instead of rescanned.
    let scanned = this.tail.length, accuracy = -Infinity, checked = scanned, usable = true;
    for (const width of fine
      ? [20000]
      : [120000, 180000, 240000, 300000, 600000]) {
      const { list: t, steps, lo, ordered } = this.window(p, width), end = t.length;
      if (end - lo < 3 || p.time - t[lo].time < width - (fine ? 1000 : 20000))
        continue;
      const first = t[lo],
        net = dist(first, p);
      if (t !== this.tail) {
        scanned = checked = end;
        accuracy = -Infinity;
        usable = true;
      }
      for (; scanned > lo; scanned -= 1) accuracy = Math.max(accuracy, t[scanned - 1].accuracy);
      const threshold = Math.max(fine ? 3 : 12, (fine ? 2 : 4) * accuracy);
      if (net <= threshold) continue;
      // Guard before positive proof, after the cheap stationary rejection.
      // NaN cannot bypass this check and become confirmed movement.
      for (; usable && checked > lo; checked -= 1) {
        const q = t[checked - 1];
        usable = !unusable(q) && !(q.latitude === 0 && q.longitude === 0);
      }
      if (!usable) continue;
      let path = 0, longest = -Infinity;
      for (let i = lo + 1; i < end; i += 1) {
        path += steps[i];
        longest = Math.max(longest, steps[i]);
      }
      if (net / path < 0.85 || longest >= net * 0.5) continue;
      if (fine) return true;
      let valid = true;
      for (let k = 0, from = lo; k < width / 30000; k++) {
        // The fixes of slice k: from first.time + k·30 s to + (k + 1)·30 s,
        // both ends included (a fix on the boundary belongs to both).
        const low = first.time + k * 30000, high = first.time + (k + 1) * 30000;
        let a = -1, b = -1, count = 0, partPath = 0;
        if (ordered) {
          while (from < end && !(t[from].time >= low)) from += 1;
          for (let i = from; i < end && t[i].time <= high; i += 1) {
            if (a < 0) a = i;
            else partPath += steps[i];
            b = i;
            count += 1;
          }
        } else {
          for (let i = lo; i < end; i += 1) {
            const q = t[i];
            if (!(q.time >= low && q.time <= high)) continue;
            if (a < 0) a = i;
            else partPath += b === i - 1 ? steps[i] : dist(t[b], q);
            b = i;
            count += 1;
          }
        }
        if (count < 3) {
          valid = false;
          break;
        }
        const n = dist(t[a], t[b]);
        if (n < 3 || n / partPath < 0.8) {
          valid = false;
          break;
        }
        const lon = Math.cos((first.latitude * Math.PI) / 180),
          dx = (p.longitude - first.longitude) * lon,
          dy = p.latitude - first.latitude,
          px = (t[b].longitude - t[a].longitude) * lon,
          py = t[b].latitude - t[a].latitude;
        if (
          (dx * px + dy * py) / Math.hypot(dx, dy) / Math.hypot(px, py) <
          0.8
        ) {
          valid = false;
          break;
        }
      }
      if (valid) return true;
    }
    return false;
  }
}

// A speed may fund distance only when the measurement supports it. A large
// uncertainty that overlaps zero cannot finance minutes of inferred walking.
export function phoneReliableSpeed(point) {
  const kmh = rawPhoneSpeed(point);
  const accuracy = point.accuracy ?? point.accuracy_meters ?? 10;
  const spread = point.speed_accuracy_mps;
  if (kmh == null || !Number.isFinite(kmh) || kmh < 0 ||
      !Number.isFinite(accuracy) || accuracy < 0 || accuracy >= 50) return null;
  const speed = kmh / 3.6;
  if (Number.isFinite(spread) && spread >= 0)
    return spread <= 1.5 || speed - spread > 0.500001 ? speed : null;
  return accuracy <= 10 || speed > 1 ? speed : null;
}

export function phoneMotionPoint(row, tracker) {
  if (
    row.session_id != null &&
    tracker.sessionId != null &&
    row.session_id !== tracker.sessionId
  ) {
    tracker.reset();
    tracker.last = 0;
    tracker.origin = null;
    tracker.lastGeometryAt = 0;
  }
  if (row.session_id != null) tracker.sessionId = row.session_id;
  // Only the fields PhoneMotion reads: a whole row copy per fix is garbage.
  const point = {
    time: row.time,
    latitude: row.raw_latitude ?? row.latitude,
    longitude: row.raw_longitude ?? row.longitude,
    accuracy: row.accuracy ?? row.accuracy_meters,
    raw_speed_kmh: row.raw_speed_kmh,
    speed_kmh: row.speed_kmh,
    speed_accuracy_mps: row.speed_accuracy_mps,
  };
  const state = tracker.accept(point);
  return {
    ...row,
    phoneObservedLatitude: row.latitude,
    phoneObservedLongitude: row.longitude,
    raw_latitude: point.latitude,
    raw_longitude: point.longitude,
    latitude: state === 'stationary' ? tracker.anchor.latitude : row.latitude,
    longitude:
      state === 'stationary' ? tracker.anchor.longitude : row.longitude,
    phoneStationary: state === 'stationary',
    phoneConfirmedMovement: tracker.movingProof && state === 'moving',
    phoneDepartureSince: tracker.departureSince,
    phoneMotionState: state,
  };
}
export function replayPhoneMotion(rows) {
  const tracker = new PhoneMotion();
  const output = [];
  for (const row of rows) {
    const point = phoneMotionPoint(row, tracker);
    if (point.phoneDepartureSince != null) {
      for (let i = output.length - 1; i >= 0; i -= 1) {
        const prior = output[i];
        if (prior.time < point.phoneDepartureSince) break;
        prior.latitude = prior.raw_latitude;
        prior.longitude = prior.raw_longitude;
        prior.phoneStationary = false;
        prior.phoneConfirmedMovement = true;
        prior.phoneMotionState = 'moving';
      }
    }
    output.push(point);
  }
  return output;
}
