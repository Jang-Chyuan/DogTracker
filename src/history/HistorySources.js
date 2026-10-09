import { applyHistoryHolds } from '../placement/IndoorHold';
import { coordinateValid, configFor, distanceMeters, atLeast, above } from './HistoryConfig';

const local = p => p.source === 'ble' || p.source === 'local';
const stamp = (row, key, fallback) => Object.prototype.hasOwnProperty.call(row, key) ? row[key] : fallback;
/** Pure boundary adapter. Explicit null locationTime means no GPS timestamp.
 * `time` is packet time; `locationTime` is GPS time, never download time.
 * Keeps raw columns for export; identity is slave_id (phone uses 'phone'). */
export function normalizeHistoryRows(rows = [], source) {
  return rows.map(row => {
    const time = Number(row.time ?? row.track_at ?? row.received_at ?? row.recorded_at);
    return { ...row, source: source ?? row.source ?? 'ble', time,
      packetTime: stamp(row, 'packetTime', time),
      locationTime: stamp(row, 'locationTime', stamp(row, 'location_at', time)),
      latitude: row.latitude ?? row.slave_lat, longitude: row.longitude ?? row.slave_lon,
      accuracy: row.accuracy ?? row.accuracy_meters };
  }).filter(p => Number.isFinite(p.time)).sort((a, b) => a.time - b.time);
}
function dedupe(rows, field) {
  const unique = new Map(), unstamped = [];
  for (const p of rows) {
    if (p[field] == null || p[field] === '') { unstamped.push(p); continue; }
    const key = `${p.slave_id ?? 'phone'}|${p[field]}`;
    const old = unique.get(key);
    if (!old || (!local(old) && local(p))) unique.set(key, p);
  }
  return [...unique.values(), ...unstamped].sort((a, b) => a.time - b.time);
}
export const mergeHistoryFixes = rows => dedupe(rows, 'locationTime');

/** Call hold replay on packets, then GPS dedupe: status changes must survive. */
export function historySourceStream(rows = [], { replayHolds = p => p } = {}) {
  const packets = dedupe(normalizeHistoryRows(rows), 'packetTime');
  const replayed = replayHolds(packets.map(p => ({ ...p })));
  // Held packets are timeline observations even without a new GPS fix.
  const gps = replayed.filter(p => !p.heldReason && coordinateValid(p) && p.locationTime != null);
  const points = [...mergeHistoryFixes(gps),
    ...replayed.filter(p => p.heldReason && coordinateValid(p))].sort((a, b) => a.time - b.time);
  return { packets, points };
}
/** spec.txt GPS 跳點 / 高速點先暫存. Synthetic points never enter logic. */
export function filterHistoryPoints(points = [], { subject = 'dog', config = configFor(subject) } = {}) {
  const input = points.filter(p => !p.synthetic && !p.interpolated && Number.isFinite(p.time) && coordinateValid(p)
    && (p.heldReason || !(p.accuracy > config.accuracyM))).slice().sort((a, b) => a.time - b.time);
  const accepted = [];
  let highRun = false;
  for (let i = 0; i < input.length; i += 1) {
    const p = input[i], previous = accepted[accepted.length - 1];
    if (!previous) { accepted.push(p); continue; }
    const dt = (p.time - previous.time) / 1000;
    if (dt <= 0) continue;
    if (p.heldReason || previous.heldReason) { accepted.push(p); continue; }
    const speed = distanceMeters(previous, p) / dt;
    if (highRun && atLeast(speed, 9) && !above(speed, 50)) { accepted.push(p); continue; }
    highRun = false;
    if (!above(speed, config.maxSpeed)) { accepted.push(p); continue; }
    if (subject !== 'dog' || above(speed, 50)) continue;
    // Three consecutive raw high-speed edges establish that this is travel.
    let last = previous, count = 0, preceding = 0;
    if (previous === input[i - 1]) {
      for (let j = i - 1; j > 0 && preceding < 2; j -= 1) {
        const seconds = (input[j].time - input[j - 1].time) / 1000;
        const v = distanceMeters(input[j - 1], input[j]) / seconds;
        if (!atLeast(v, 9) || above(v, 50) || !accepted.includes(input[j - 1])) break;
        preceding += 1;
      }
    }
    for (let j = i; j < input.length; j += 1) {
      const next = input[j], seconds = (next.time - last.time) / 1000;
      const v = seconds > 0 ? distanceMeters(last, next) / seconds : Infinity;
      if (!atLeast(v, 9) || above(v, 50) || next.heldReason) break;
      count += 1; last = next;
      if (count + preceding >= 3) break;
    }
    if (count + preceding >= 3) {
      accepted.push(...input.slice(i, i + count)); i += count - 1; highRun = true;
    }
  }
  return accepted;
}

/** Reuse the live pure hold tracker, replaying deduped packets rather than GPS
 * fixes. Read-only adapters should supply context back to the anchor (<=24h).
 * Already annotated observations are preserved by the existing hold tracker. */
export function replayHistoryHolds(packets, { since = -Infinity, ...holdOptions } = {}) {
  return applyHistoryHolds(packets.filter(p => p.time >= since - 86400000), holdOptions);
}
