// Simulated collar rows for the indoor hold. Every number here is an
// assumption, not a measurement: the scenarios exist to find the cases where
// the rules break, and the real thresholds still need field logs.
import { distanceMeters, medianPoint } from '../src/placement/IndoorHold';

export const HOME = { latitude: 24.9936, longitude: 121.301 };

export function rng(seed) {
  // A plain linear congruential generator: reproducible, no bit tricks.
  let state = (Math.abs(Math.floor(seed)) % 4294967296) || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  next.uniform = (low, high) => low + next() * (high - low);
  next.gauss = (sigma = 1) => {
    const u = Math.max(next(), 1e-12), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
  };
  return next;
}

export function offset(point, northM, eastM) {
  return {
    latitude: point.latitude + northM / 111320,
    longitude: point.longitude + eastM / (111320 * Math.cos(point.latitude * Math.PI / 180)),
  };
}

const lerp = (a, b, f) => ({ latitude: a.latitude + (b.latitude - a.latitude) * f,
  longitude: a.longitude + (b.longitude - a.longitude) * f });

/**
 * A segment: { kind, minutes, from, to, usb, fix, goodShare, master }
 * kind: open | forest | indoor | window | drive | silent
 * fix: share of rows with any fix (indoor/window)
 * master: where the receiver is; 'home' (default), 'dog' (handler next to the
 * dog), or a point.
 */
export function generate(segments, { seed = 1, stepSeconds = 5, loss = 0.05 } = {}) {
  const random = rng(seed);
  const rows = [];
  let time = 1_800_000_000_000;
  let bias = { n: 0, e: 0 };
  let jump = null;
  for (const segment of segments) {
    const steps = Math.round(segment.minutes * 60 / stepSeconds);
    if (segment.kind === 'indoor' || segment.kind === 'window') bias = { n: 0, e: 0 };
    for (let step = 0; step < steps; step += 1) {
      time += stepSeconds * 1000;
      const truth = lerp(segment.from, segment.to ?? segment.from, steps > 1 ? step / (steps - 1) : 1);
      const master = segment.master === 'dog' ? offset(truth, 8, 5)
        : segment.master && segment.master.latitude ? segment.master : HOME;
      const metres = Math.max(distanceMeters(truth, master), 5);
      const wall = segment.kind === 'indoor' ? 10 : segment.kind === 'window' ? 5 : 0;
      const rssi = Math.max(-130, -42 - 22 * Math.log10(metres / 5) - wall + random.gauss(2));
      const snr = Math.max(-18, Math.min(12, 10 + (rssi + 92) / 3 + random.gauss(1)));
      // LoRa below this level does not arrive at all, and some rows always get lost.
      if (segment.kind === 'silent' || rssi < -124 || random() < loss) continue;
      const row = { time, master_id: 5, slave_id: 4, rssi: Math.round(rssi), snr: Math.round(snr * 4) / 4,
        usb_present: segment.usb ? 1 : 0, truth, segment: segment.label ?? segment.kind,
        moving: !!segment.to && distanceMeters(segment.from, segment.to) > 1 };
      const emit = (sats, hdop, northM, eastM) => {
        const position = offset(truth, northM, eastM);
        Object.assign(row, { latitude: position.latitude, longitude: position.longitude,
          satellites: Math.round(sats), hdop: Math.round(hdop * 100) / 100 });
      };
      const none = () => Object.assign(row, { latitude: 0, longitude: 0, satellites: 0, hdop: 655.35 });
      if (segment.kind === 'open' || segment.kind === 'drive') {
        emit(random.uniform(8, 12), random.uniform(0.7, 1.3), random.gauss(3), random.gauss(3));
      } else if (segment.kind === 'forest') {
        if (random() < 0.15) none();
        else if (random() < (segment.goodShare ?? 0.25)) {
          emit(random.uniform(5, 7), random.uniform(1.4, 2), random.gauss(6), random.gauss(6));
        } else emit(random.uniform(3, 5), random.uniform(2.2, 4.5), random.gauss(12), random.gauss(12));
      } else if (segment.kind === 'indoor' || segment.kind === 'window') {
        // Indoor error wanders (multipath), reverts slowly, and now and then
        // jumps a few hundred metres for a few rows.
        bias.n = bias.n * 0.98 + random.gauss(6);
        bias.e = bias.e * 0.98 + random.gauss(6);
        const spread = Math.hypot(bias.n, bias.e);
        if (spread > 120) { bias.n *= 120 / spread; bias.e *= 120 / spread; }
        if (!jump && random() < 0.02) jump = { n: random.gauss(220), e: random.gauss(220), left: Math.ceil(random.uniform(1, 4)) };
        const fixShare = segment.fix ?? (segment.kind === 'window' ? 0.9 : 0.5);
        if (random() >= fixShare) none();
        else if (jump) {
          emit(random.uniform(3, 5), random.uniform(3, 9), bias.n + jump.n, bias.e + jump.e);
          jump.left -= 1;
          if (jump.left <= 0) jump = null;
        } else if (random() < (segment.goodShare ?? (segment.kind === 'window' ? 0.5 : 0.03))) {
          // Good-looking fixes indoors are the dangerous ones: by a window they
          // are close, through multipath they can be 40-80 m off.
          const off = segment.kind === 'window' ? 12 : random.uniform(40, 80);
          const angle = random.uniform(0, 2 * Math.PI);
          emit(random.uniform(5, 8), random.uniform(1.3, 2), off * Math.cos(angle), off * Math.sin(angle));
        } else emit(random.uniform(3, 5), random.uniform(2.5, 8), bias.n, bias.e);
      }
      rows.push(row);
    }
  }
  return rows;
}

// What main draws without a set point: valid fixes through the three-point
// display average, the last one kept when a row has none.
export function displayRaw(rows) {
  let window = [], last = null;
  return rows.map(row => {
    const valid = row.latitude !== 0 || row.longitude !== 0;
    if (valid) {
      window.push(row);
      if (window.length > 3) window.shift();
      last = meanPoint(window);
    }
    return last;
  });
}
function meanPoint(points) {
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

export { medianPoint };
