// When this phone's own receiver last heard each dog (F7, 2026-10-15): the
// newest packet and the newest valid position among this phone's BLE rows,
// whatever the newest row of the dog is. A dog heard by this phone and by a
// teammate is shown at whichever row is newest (DogMerge), so the merged dog
// alone cannot say whether this phone still hears it; the background alerts
// need exactly that (AlertNotifications.isLocalDog).
//
// Pure: no React, no SQLite.

const finite = value => (Number.isFinite(value) ? value : null);
// A collar without a fix reports 0,0 (DogMerge.hasFix).
const hasFix = (latitude, longitude) => Number.isFinite(latitude) && Number.isFinite(longitude)
  && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

/**
 * @param point the connected pair's latest BLE row (DogStatus model)
 * @param packets useCloudDogs' packet rows; only `source: 'ble'` ones count
 * @returns {{ [slaveId]: { packetAt: number|null, fixAt: number|null } }}
 */
export function localReception({ point = null, packets = [] } = {}) {
  const result = {};
  const note = (slaveId, time, fix) => {
    if (slaveId == null || time == null) return;
    const entry = result[slaveId] ?? (result[slaveId] = { packetAt: null, fixAt: null });
    if (entry.packetAt == null || time > entry.packetAt) entry.packetAt = time;
    if (fix && (entry.fixAt == null || time > entry.fixAt)) entry.fixAt = time;
  };
  for (const row of packets || []) {
    if (row?.source !== 'ble') continue;
    note(row.slave_id, finite(row.received_at) ?? finite(row.track_at),
      hasFix(Number(row.slave_lat), Number(row.slave_lon)));
  }
  if (point?.slaveId != null) {
    note(point.slaveId, finite(point.receivedAt), hasFix(point.slaveLat, point.slaveLon));
  }
  return result;
}
