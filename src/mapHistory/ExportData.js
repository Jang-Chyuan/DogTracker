import { coordinate } from '../tracking/RouteSamples';
import { localDateParts } from './ExportFiles';

// Immutable export snapshot contract: {since, until, timeZone, subjects}.
// Subject: {kind:'dog'|'phone', name, slaveId, rows, holds, stays, rides,
// gaps, timeline, distanceKm, routeColor}. Intervals use {start,end}; end is
// exclusive for classification (ride end belongs to walking). Range is inclusive.
// Source filtering/deduplication and stay detection belong to the caller.
export const gpsTime = row => row.location_at ?? row.time ?? row.recorded_at;
export const packetTime = row => row.time ?? row.recorded_at ?? row.location_at;
// The coordinates a row exports: a dog's are the collar's own fix (raw_*
// when supplied, else slave_lat/slave_lon) — never a display position; my
// route's are the recorded route (myLocationTracker latitude/longitude, the
// ones the screen draws and 「今天 x km」 adds up), raw_* go to their own CSV columns.
export const rawCoordinate = (row, subject = null) => subject?.kind === 'phone'
  ? coordinate(row.latitude, row.longitude) : coordinate(
  Object.prototype.hasOwnProperty.call(row, 'raw_latitude') ? row.raw_latitude : row.latitude,
  Object.prototype.hasOwnProperty.call(row, 'raw_longitude') ? row.raw_longitude : row.longitude,
);
export const inInterval = (time, interval) => time >= interval.start && time < interval.end;
export const subjectName = subject => subject.kind === 'phone' ? '我的路線' : `${subject.name || `狗 ${subject.slaveId}`}-${subject.slaveId}`;
export const displayName = subject => subject.kind === 'phone' ? '我的路線' : `${subject.name || `狗 ${subject.slaveId}`}（訊號源 ${subject.slaveId}）`;
export function validateSnapshot(snapshot) {
  if (!Number.isFinite(snapshot.since) || !Number.isFinite(snapshot.until) || snapshot.since > snapshot.until) throw new Error('匯出範圍無效');
  const day = time => { const p = localDateParts(time, snapshot.timeZone); return `${p.year}${p.month}${p.day}`; };
  if (day(snapshot.since) !== day(snapshot.until)) throw new Error('匯出範圍必須在同一天');
}
export function activeSubjects(snapshot) {
  validateSnapshot(snapshot);
  return (snapshot.subjects || []).filter(subject => (subject.rows || []).some(row => packetTime(row) >= snapshot.since && packetTime(row) <= snapshot.until));
}
export function clippedIntervals(interval, snapshot, gaps = []) {
  let pieces = [{ start: Math.max(interval.start, snapshot.since), end: Math.min(interval.end, snapshot.until) }].filter(p => p.end > p.start);
  for (const gap of gaps) pieces = pieces.flatMap(p => {
    if (gap.end <= p.start || gap.start >= p.end) return [p];
    return [{ start: p.start, end: Math.min(p.end, gap.start) }, { start: Math.max(p.start, gap.end), end: p.end }].filter(part => part.end > part.start);
  });
  return pieces;
}
export function exportRows(subject, snapshot) {
  // In the range by the packet's time (the screen's range is made of packet
  // times); a fix's own time still decides its hold or ride (ExportGPX).
  return (subject.rows || []).filter(row => Number.isFinite(gpsTime(row)) && packetTime(row) >= snapshot.since && packetTime(row) <= snapshot.until)
    .slice().sort((a, b) => gpsTime(a) - gpsTime(b));
}

// Capture data rather than retaining references to live history state.
export function captureExportSnapshot(snapshot) {
  validateSnapshot(snapshot);
  const copy = value => {
    if (Array.isArray(value)) return Object.freeze(value.map(copy));
    if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])));
    return value;
  };
  return copy(snapshot);
}
// Pure deadline decision: callers own network requests and cancellation.
export function exportAddressState({ online, elapsedMs = 0, address, failed = false }) {
  if (address) return { status: 'resolved', address };
  if (!online || failed || elapsedMs >= 5000) return { status: 'missing', address: null, text: '' };
  return { status: 'pending', address: null, remainingMs: 5000 - elapsedMs };
}
