import { t } from '../i18n';
import { usbPresent } from '../models/UsbPresent';
import { cloudTrackTime } from './CloudTrackTime';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * One dog_telemetry row as supabase_dog_status stores it.
 *
 * Only the server's own columns are refused (event_id, received_at,
 * master_id, slave_id): the page cursor and the dog come from them, and
 * Postgres types them. The payload is what a receiver sent, and one garbled
 * packet must never stop a batch (2026-10-21: `usbPresent: 136` threw here,
 * and the archive pass stopped on that page every round). A field that cannot
 * be read is unknown (null; a validity flag 0, not believed) and the row is
 * kept, as a packet without that reading. A fix is believed only with both
 * coordinates readable and in range; otherwise the row has no fix (unreadable
 * satellites or HDOP are unknown, as when a packet leaves them out). A payload that is not an object, or names another dog
 * (`slaveId`), gives the row no readings at all. `malformed` (MalformedFields,
 * optional) is told about each such field, for one line per batch.
 */
export function mapCloudTelemetry(row, malformed = null) {
  if (!UUID.test(row.event_id) || !TIMESTAMP.test(row.received_at) ||
      !Number.isFinite(Date.parse(row.received_at)) || !Number.isInteger(row.master_id) ||
      !Number.isInteger(row.slave_id)) {
    throw new Error(t("c588"));
  }
  // `rows.map(mapCloudTelemetry)` passes an index here: not a collector.
  const sink = typeof malformed?.note === 'function' ? malformed : null;
  sink?.row?.();
  const note = (field, value) => sink?.note(field, value);
  let p = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : null;
  if (!p) note('payload', row.payload);
  else if (p.slaveId != null && p.slaveId !== row.slave_id) { note('slaveId', p.slaveId); p = null; }
  p = p || {};
  let bad = false;
  const number = (field, value, divisor = 1) => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      note(field, value); bad = true;
      return null;
    }
    return value / divisor;
  };
  const read = (field, divisor) => { bad = false; return number(field, p[field], divisor); };
  // A byte, nonzero = valid (the phone ingest's 0–255). Booleans as 1/0.
  const flag = field => {
    const value = p[field];
    if (value == null) return 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (!Number.isInteger(value) || value < 0 || value > 255) { note(field, value); return 0; }
    return value ? 1 : 0;
  };
  const text = field => {
    const result = read(field);
    return result == null ? null : String(result);
  };
  let lat = read('lat', 1000000), latBad = bad;
  let lon = read('lon', 1000000), lonBad = bad;
  const satellites = read('satellites');
  const hdop = read('hdop', 100);
  if (!latBad && Number.isFinite(lat) && (lat < -90 || lat > 90)) { note('lat', p.lat); latBad = true; }
  if (!lonBad && Number.isFinite(lon) && (lon < -180 || lon > 180)) { note('lon', p.lon); lonBad = true; }
  // A wire value too small to survive the division is not the 0,0 "no fix".
  if (lat === 0 && lon === 0 && (p.lat !== 0 || p.lon !== 0)) { note('lat', p.lat); latBad = true; }
  // Half a fix is no fix.
  if (latBad || lonBad || (lat == null) !== (lon == null)) { lat = null; lon = null; }
  return {
    ...cloudTrackTime(row), track_time_version: 1,
    event_id: row.event_id.toLowerCase(), remote_received_at: row.received_at,
    received_at: Date.parse(row.received_at), master_id: row.master_id,
    slave_id: row.slave_id, sequence: number('seq', row.seq),
    slave_lat: lat, slave_lon: lon,
    speed_kmh: read('speed', 100), satellites, hdop,
    activity: read('activityScore', 1000), activity_valid: flag('activityValid'),
    battery_mv: read('batteryMillivolts'), battery_percentage: read('batteryPercentage'),
    battery_valid: flag('batteryValid'),
    usb_present: usbPresent(p.usbPresent, sink),
    // Slave time bases are not established: preserve raw values, not Unix dates.
    gps_time: text('gpsTimestamp'), activity_time: text('activityTimestamp'),
    rssi: number('rssi', row.rssi), snr: number('snr', row.snr), raw_payload: JSON.stringify(row),
  };
}

export function taiwanDateRange(start, end, now = Date.now()) {
  const parse = text => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(t("c592"));
    const utc = Date.parse(`${text}T00:00:00Z`);
    if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== text) {
      throw new Error(t("c593"));
    }
    return utc - 8 * 60 * 60 * 1000;
  };
  const from = parse(start);
  const last = parse(end);
  const until = Math.min(last + 86400000, now);
  if (from > last || from >= until) throw new Error(t("c591"));
  return { startAt: new Date(from).toISOString(), endBefore: new Date(until).toISOString() };
}
