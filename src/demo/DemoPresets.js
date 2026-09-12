// Fixed Taoyuan DB rows. No timer, BLE callback or map renderer imports these.
export const DEMO_PRESETS = Object.freeze([
  Object.freeze({
    key: 'A',
    masterLat: 25.0175,
    masterLon: 121.325,
    slaveLat: 25.01825,
    slaveLon: 121.3258,
    speedKmh: 2.4,
  }),
  Object.freeze({
    key: 'B',
    masterLat: 25.0178,
    masterLon: 121.32535,
    slaveLat: 25.0189,
    slaveLon: 121.32645,
    speedKmh: 3.1,
  }),
  Object.freeze({
    key: 'C',
    masterLat: 25.0181,
    masterLon: 121.3257,
    slaveLat: 25.01765,
    slaveLon: 121.3267,
    speedKmh: 1.8,
  }),
]);

export function createDemoPresetRow(key, receivedAt = Date.now()) {
  const preset = DEMO_PRESETS.find(value => value.key === key);
  if (!preset) throw new RangeError('未知的 Demo 預設點');
  if (
    !Number.isSafeInteger(receivedAt) ||
    receivedAt < 0 ||
    receivedAt > 8640000000000000
  )
    throw new RangeError('Demo 時間無效');
  const radians = value => (value * Math.PI) / 180;
  const lat = radians(preset.slaveLat - preset.masterLat);
  const lon = radians(preset.slaveLon - preset.masterLon);
  const a =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(preset.masterLat)) *
      Math.cos(radians(preset.slaveLat)) *
      Math.sin(lon / 2) ** 2;
  const time = new Date(receivedAt).toISOString();
  return {
    received_at: receivedAt,
    master_id: 1,
    slave_id: 1,
    master_lat: preset.masterLat,
    master_lon: preset.masterLon,
    slave_lat: preset.slaveLat,
    slave_lon: preset.slaveLon,
    distance_meters: Math.round(6371000 * 2 * Math.asin(Math.sqrt(a))),
    speed_kmh: preset.speedKmh,
    satellites: 12,
    hdop: 0.9,
    activity: 'WALK',
    activity_valid: 1,
    battery_mv: 3900,
    battery_percentage: 75,
    battery_valid: 1,
    master_battery_mv: 4100,
    master_battery_percentage: 90,
    master_battery_valid: 1,
    rssi: -80,
    snr: 8,
    gps_time: time,
    activity_time: time,
    packet_type: 'DEMO_' + key,
    sequence: null,
    packet_length: null,
    raw_payload: JSON.stringify({ source: 'manual-demo', preset: key }),
  };
}

export function createDemoSeed(now = Date.now()) {
  // Current operation time, never the static date printed in the UI document.
  return DEMO_PRESETS.map((preset, index) =>
    createDemoPresetRow(preset.key, Math.max(0, now - (2 - index) * 1000)),
  );
}
