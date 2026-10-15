import { t } from '../i18n';
import { usbPresent } from '../models/UsbPresent';

function number(data, key, min, max, scale = 1) {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(t("c603", { key: key }));
  const result = Math.round(value * scale);
  if (result < min || result > max || (scale === 1 && !Number.isInteger(value))) throw new Error(t("c604", { key: key }));
  return result;
}
/**
 * A packet's own Master ID as the receiver check and the upload queue read it
 * (ReceiverMasterId.of in Kotlin): `master_id`, else `mid`; a number or a
 * numeric string (`"mid":"5"`), whole, 1–65535. null when it has none.
 */
export function packetMasterId(data) {
  return wholeId(data?.master_id != null ? data.master_id : data?.mid, 65535);
}
/**
 * A packet's dog (slave) ID as DogStatusStore stores it (ReceiverMasterId.
 * slaveOf in Kotlin): `slave_id`, else `sid`; a number or a numeric string
 * (`"sid":"4"`), whole, 1 or more. null when it has none.
 */
export function packetSlaveId(data) {
  return wholeId(data?.slave_id != null ? data.slave_id : data?.sid, 2147483647);
}
function wholeId(raw, max) {
  const value = typeof raw === 'number' ? raw
    : typeof raw === 'string' && /^\+?\d+(\.\d*)?$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

export function bleUploadPayload(row, phoneId) {
  const d = JSON.parse(row.payload_json);
  if (d.type !== 3) throw new Error(t("c600"));
  const master = packetMasterId(d), slave = packetSlaveId(d);
  if (master == null) throw new Error(t("c603", { key: 'mid' }));
  if (slave == null) throw new Error(t("c603", { key: 'sid' }));
  if (slave > 255) throw new Error(t("c604", { key: 'sid' }));
  if (master !== row.master_id) throw new Error(t("c602"));
  const signal = key => {
    if (typeof d[key] !== 'number' || !Number.isFinite(d[key]) || Math.abs(d[key]) > 300) throw new Error(t("c601", { key: key }));
    return d[key];
  };
  const usb = usbPresent(d.usbPresent ?? d.usb_present);
  return { event_id: row.event_id, phone_id: phoneId, master_id: master, slave_id: slave,
    phone_received_at: new Date(row.received_at).toISOString(), seq: number(d, 'seq', 0, 65535),
    rssi: signal('rssi'), snr: signal('snr'), payload: {
      ...(usb === null ? {} : { usbPresent: usb }),
      lat: number(d, 'lat', -90000000, 90000000, 1000000),
      lon: number(d, 'lon', -180000000, 180000000, 1000000),
      speed: number(d, 'speed_kmh', 0, 65535, 100), satellites: number(d, 'sat', 0, 255),
      hdop: number(d, 'hdop', 0, 65535, 100), gpsTimestamp: number(d, 'gps_time', 0, 4294967295),
      activityScore: number(d, 'activity', 0, 65535, 1000), activityValid: number(d, 'activity_valid', 0, 255),
      activityTimestamp: number(d, 'activity_time', 0, 4294967295),
      batteryMillivolts: number(d, 'battery_mv', 0, 65535), batteryPercentage: number(d, 'battery_pct', 0, 255),
      batteryValid: number(d, 'battery_valid', 0, 255), slaveId: slave,
    } };
}
