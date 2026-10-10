// The stored rows as the history logic reads them (README: common rows
// {time, latitude, longitude, source, slave_id, packetTime, locationTime,
// accuracy}). Pure: HistoryDatabase.historyDayRows reads the tables, a screen
// fixture hands in invented rows of the same tables.

const finite = value => (value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * A dog_status ('local') or supabase_dog_status ('cloud') row. The packet
 * time is when the phone received it (a cloud row keeps the uploading
 * phone's time in track_at), so the same packet has the same time in both
 * tables (判定表「停在原處封包的去重」). The fix's own time is the collar's
 * gps_time: the same fix repeated in later packets, or downloaded again from
 * the cloud, is one observation (判定表「同一隻狗本機和雲端同時有」); without
 * one the packet time stands in. Raw columns stay for the hold model.
 */
export function dogHistoryRow(row, source) {
  const packetTime = source === 'cloud'
    ? finite(row.track_at) ?? finite(row.received_at) : finite(row.received_at);
  const gps = finite(row.gps_time);
  return { ...row, source, time: packetTime, packetTime,
    locationTime: gps && gps > 0 ? `gps:${gps}` : packetTime,
    latitude: finite(row.slave_lat), longitude: finite(row.slave_lon) };
}

/**
 * A myLocationTracker row (this phone, my route): the recording's pipeline
 * coordinates and time, the same ones 「今天 x km」 adds up.
 */
export function phoneHistoryRow(row) {
  const time = finite(row.time ?? row.recorded_at);
  return { ...row, source: 'local', slave_id: 'phone', time, packetTime: time, locationTime: time,
    latitude: finite(row.latitude), longitude: finite(row.longitude),
    accuracy: finite(row.accuracy ?? row.accuracy_meters) };
}
