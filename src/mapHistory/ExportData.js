import { coordinate } from '../tracking/RouteSamples';

// Immutable export snapshot contract: {since, until, timeZone, subjects}.
// Subject: {kind:'dog'|'phone', name, slaveId, rows, holds, stays, rides,
// gaps, timeline, distanceKm, routeColor}. Intervals use {start,end}; end is
// exclusive for classification (ride end belongs to walking). Range is inclusive.
// Source filtering/deduplication and stay detection belong to the caller.
export const gpsTime = row => row.location_at ?? row.time ?? row.recorded_at;
export const packetTime = row => row.time ?? row.recorded_at ?? row.location_at;
export const rawCoordinate = row => coordinate(
  Object.prototype.hasOwnProperty.call(row, 'raw_latitude') ? row.raw_latitude : row.latitude,
  Object.prototype.hasOwnProperty.call(row, 'raw_longitude') ? row.raw_longitude : row.longitude,
);
export const inInterval = (time, interval) => time >= interval.start && time < interval.end;
export const subjectName = subject => subject.kind === 'phone' ? '我的路線' : `${subject.name || `狗 ${subject.slaveId}`}-${subject.slaveId}`;
export const displayName = subject => subject.kind === 'phone' ? '我的路線' : `${subject.name || `狗 ${subject.slaveId}`}（訊號源 ${subject.slaveId}）`;
export function validateSnapshot(snapshot) {
  if (!Number.isFinite(snapshot.since) || !Number.isFinite(snapshot.until) || snapshot.since > snapshot.until) throw new Error('匯出範圍無效');
  const day = time => new Intl.DateTimeFormat('en-CA', { timeZone: snapshot.timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
  if (day(snapshot.since) !== day(snapshot.until)) throw new Error('匯出範圍必須在同一天');
}
export function activeSubjects(snapshot) {
  validateSnapshot(snapshot);
  return (snapshot.subjects || []).filter(subject => (subject.rows || []).some(row => packetTime(row) >= snapshot.since && packetTime(row) <= snapshot.until));
}
export function clippedIntervals(interval, snapshot, gaps = []) {
  let pieces = [{ start: Math.max(interval.start, snapshot.since), end: Math.min(interval.end, snapshot.until) }].filter(p => p.end >= p.start);
  for (const gap of gaps) pieces = pieces.flatMap(p => {
    if (gap.end <= p.start || gap.start >= p.end) return [p];
    return [{ start: p.start, end: Math.min(p.end, gap.start) }, { start: Math.max(p.start, gap.end), end: p.end }].filter(part => part.end > part.start);
  });
  return pieces;
}
export function exportRows(subject, snapshot) {
  return (subject.rows || []).filter(row => Number.isFinite(gpsTime(row)) && gpsTime(row) >= snapshot.since && gpsTime(row) <= snapshot.until)
    .slice().sort((a, b) => gpsTime(a) - gpsTime(b));
}
