function number(data, key, min, max, scale = 1) {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`缺少或無效欄位：${key}`);
  const result = Math.round(value * scale);
  if (result < min || result > max || (scale === 1 && !Number.isInteger(value))) throw new Error(`欄位超出範圍：${key}`);
  return result;
}
export function bleUploadPayload(row, phoneId) {
  const d = JSON.parse(row.payload_json);
  if (d.type !== 3) throw new Error('只接受 Dog Status TYPE=3');
  const master = number(d, 'mid', 1, 65535), slave = number(d, 'sid', 1, 255);
  if (master !== row.master_id) throw new Error('Master 不一致');
  const signal = key => {
    if (typeof d[key] !== 'number' || !Number.isFinite(d[key]) || Math.abs(d[key]) > 300) throw new Error(`訊號欄位無效：${key}`);
    return d[key];
  };
  return { event_id: row.event_id, phone_id: phoneId, master_id: master, slave_id: slave,
    phone_received_at: new Date(row.received_at).toISOString(), seq: number(d, 'seq', 0, 65535),
    rssi: signal('rssi'), snr: signal('snr'), payload: {
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
