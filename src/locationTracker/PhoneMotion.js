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
  }
  reset() {
    this.tail = [];
    this.entry = [];
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
    this.entry = [];
    this.state = 'moving';
    this.movingProof = true;
    return this.state;
  }
  progress(p, points, qualityAware = false) {
    if (points.length < 3 || p.time - points[0].time < 15000
      || points.some(q => !Number.isFinite(q.accuracy) || q.accuracy < 0 || q.accuracy >= 50
        || !Number.isFinite(q.latitude) || !Number.isFinite(q.longitude)
        || Math.abs(q.latitude) > 90 || Math.abs(q.longitude) > 180)) return false;
    const net = dist(points[0], p), steps = points.slice(1).map((q, i) => dist(points[i], q));
    const path = steps.reduce((sum, step) => sum + step, 0);
    const threshold = qualityAware ? Math.max(3, ...points.map(q => q.accuracy * 2)) : 3;
    return net > threshold + 1e-8 && net / path > (qualityAware ? 0.85 : 0.75) && Math.max(...steps) < net * 0.5;
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
  pushSample(list, point) {
    this.origin ??= point.time;
    const bucket = value => Math.floor((value.time - this.origin) / 1000);
    if (list.length && bucket(list.at(-1)) === bucket(point))
      list[list.length - 1] = point;
    else list.push(point);
  }
  accept(p) {
    this.departureSince = null;
    if (this.last && (p.time <= this.last || p.time - this.last > 30000)) this.reset();
    this.last = p.time;
    this.pushSample(this.tail, p);
    this.tail = this.tail.filter(q => p.time - q.time <= 600000).slice(-720);
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
    // Reliable measured walking already has finite speed credit. Reserve the
    // extra geometry pass for absent/contradictory/uncertain speed evidence.
    if (this.strictReentry && (!valid || speed < 0.3 || (spread && sacc > 1.5 && !high)
      || (!spread && p.accuracy > 10 && speed <= 1)))
      this.movingProof = this.progress(p, this.tail.filter(q => p.time - q.time <= 60000), true);
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
      if (!speedGood && p.time - this.lowAt > 180000) {
        this.reset();
        return 'unknown';
      }
      return this.state;
    }
    if (!speedGood) {
      this.entry = [];
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
    this.pushSample(this.entry, p);
    while (this.entry.length > 1 && p.time - this.entry[1].time >= 20000)
      this.entry.shift();
    const first = this.entry[0],
      path = this.entry
        .slice(1)
        .reduce((a, q, i) => a + dist(this.entry[i], q), 0),
      net = dist(first, p);
    const fine = this.entry.every(q => q.accuracy <= 10),
      threshold = fine ? 3 : Math.max(5, ...this.entry.map(q => q.accuracy * (this.strictReentry ? 2 : 1)));
    const reentryProgress = this.strictReentry && this.progress(p, this.entry);
    // A 3m guard only rejects reentry. Backfilling further travel still needs
    // the original long, quality-aware proof, plus current progress.
    if (reentryProgress && p.time - this.lastGeometryAt >= 5000) {
      this.lastGeometryAt = p.time;
      if (this.departure(p)) return this.continueMoving(p);
    }
    if (
      this.entry.some(q => dist(first, q) > threshold) ||
      (fine && net > 3 && net / path > 0.75) || reentryProgress
    ) {
      this.entry = [];
      if (!this.strictReentry) this.tail = [];
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
      this.tail = this.entry.slice();
    } else if (!this.strictReentry) this.tail = this.entry.slice();
    return this.state;
  }
  departure(p) {
    const fine = this.tail
      .filter(q => p.time - q.time <= 20000)
      .every(q => q.accuracy <= 10);
    for (const width of fine
      ? [20000]
      : [120000, 180000, 240000, 300000, 600000]) {
      const t = this.tail.filter(q => p.time - q.time <= width);
      if (t.length < 3 || p.time - t[0].time < width - (fine ? 1000 : 20000))
        continue;
      const first = t[0],
        net = dist(first, p);
      const threshold = Math.max(
        fine ? 3 : 12,
        (fine ? 2 : 4) * Math.max(...t.map(q => q.accuracy)),
      );
      if (net <= threshold) continue;
      // Guard before positive proof, after the cheap stationary rejection.
      // NaN cannot bypass this check and become confirmed movement.
      if (t.some(q => !Number.isFinite(q.accuracy) || q.accuracy < 0 || q.accuracy >= 50
        || !Number.isFinite(q.latitude) || !Number.isFinite(q.longitude)
        || Math.abs(q.latitude) > 90 || Math.abs(q.longitude) > 180
        || (q.latitude === 0 && q.longitude === 0))) continue;
      const steps = t.slice(1).map((q, i) => dist(t[i], q));
      const path = steps.reduce((a, b) => a + b, 0);
      if (net / path < 0.85 || Math.max(...steps) >= net * 0.5) continue;
      if (fine) return true;
      let valid = true;
      for (let k = 0; k < width / 30000; k++) {
        const part = t.filter(
          q =>
            q.time >= first.time + k * 30000 &&
            q.time <= first.time + (k + 1) * 30000,
        );
        if (part.length < 3) {
          valid = false;
          break;
        }
        const a = part[0],
          b = part.at(-1),
          n = dist(a, b),
          partPath = part
            .slice(1)
            .reduce((sum, q, i) => sum + dist(part[i], q), 0);
        if (n < 3 || n / partPath < 0.8) {
          valid = false;
          break;
        }
        const lon = Math.cos((first.latitude * Math.PI) / 180),
          dx = (p.longitude - first.longitude) * lon,
          dy = p.latitude - first.latitude,
          px = (b.longitude - a.longitude) * lon,
          py = b.latitude - a.latitude;
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
  const point = {
    ...row,
    latitude: row.raw_latitude ?? row.latitude,
    longitude: row.raw_longitude ?? row.longitude,
    accuracy: row.accuracy ?? row.accuracy_meters,
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
