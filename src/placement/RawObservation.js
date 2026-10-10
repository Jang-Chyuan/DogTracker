// Explicit raw columns win, including null: a missing fix must not turn into
// the held display anchor. Dog database rows retain slave_lat/slave_lon.
export function rawCoordinate(row) {
  const has = key => Object.prototype.hasOwnProperty.call(row, key);
  const latitude = has('raw_latitude') ? row.raw_latitude : has('slave_lat') ? row.slave_lat : row.latitude;
  const longitude = has('raw_longitude') ? row.raw_longitude : has('slave_lon') ? row.slave_lon : row.longitude;
  return { latitude, longitude };
}

export function rawSpeedKmh(row) {
  const value = Object.prototype.hasOwnProperty.call(row, 'raw_speed_kmh') ? row.raw_speed_kmh : row.speed_kmh;
  return value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
}
