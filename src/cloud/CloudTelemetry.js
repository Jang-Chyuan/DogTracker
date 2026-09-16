const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function mapCloudTelemetry(row) {
  const p = row.payload;
  if (!UUID.test(row.event_id) || !TIMESTAMP.test(row.received_at) ||
      !Number.isFinite(Date.parse(row.received_at)) || !Number.isInteger(row.master_id) ||
      !Number.isInteger(row.slave_id) || !p || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('雲端紀錄格式不正確，該批資料未儲存');
  }
  const number = (value, divisor = 1) => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('雲端數值格式不正確，該批資料未儲存');
    }
    return value / divisor;
  };
  if (p.slaveId != null && p.slaveId !== row.slave_id) {
    throw new Error('雲端 Slave 編號不一致，該批資料未儲存');
  }
  return {
    event_id: row.event_id.toLowerCase(), remote_received_at: row.received_at,
    received_at: Date.parse(row.received_at), master_id: row.master_id,
    slave_id: row.slave_id, sequence: number(row.seq),
    slave_lat: number(p.lat, 1000000), slave_lon: number(p.lon, 1000000),
    speed_kmh: number(p.speed, 100), satellites: number(p.satellites),
    hdop: number(p.hdop, 100), activity: number(p.activityScore, 1000),
    activity_valid: number(p.activityValid) ? 1 : 0,
    battery_mv: number(p.batteryMillivolts), battery_percentage: number(p.batteryPercentage),
    battery_valid: number(p.batteryValid) ? 1 : 0,
    // Slave time bases are not established: preserve raw values, not Unix dates.
    gps_time: p.gpsTimestamp == null ? null : String(number(p.gpsTimestamp)),
    activity_time: p.activityTimestamp == null ? null : String(number(p.activityTimestamp)),
    rssi: number(row.rssi), snr: number(row.snr), raw_payload: JSON.stringify(row),
  };
}

export function taiwanDateRange(start, end, now = Date.now()) {
  const parse = text => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('日期請填 YYYY-MM-DD');
    const utc = Date.parse(`${text}T00:00:00Z`);
    if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== text) {
      throw new Error('日期不存在');
    }
    return utc - 8 * 60 * 60 * 1000;
  };
  const from = parse(start);
  const last = parse(end);
  const until = Math.min(last + 86400000, now);
  if (from > last || from >= until) throw new Error('請選擇有效的過去日期範圍');
  return { startAt: new Date(from).toISOString(), endBefore: new Date(until).toISOString() };
}
