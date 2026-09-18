import { latestPosition } from './TrackingGeometry';

// A slave_id identifies the same dog across the whole team, whichever Master
// received it (confirmed 2026-09-17). The home map therefore shows one marker
// per dog and takes the newest row of all sources.
export const FRESH_MS = 10 * 60 * 1000;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_DOGS = 20;

const coordinate = row => (
  Number.isFinite(row?.slave_lat) && Number.isFinite(row?.slave_lon)
    ? { latitude: row.slave_lat, longitude: row.slave_lon } : null);

/**
 * @param point latest BLE row of the connected pair (DogStatus model)
 * @param samples position context rows used to retain the last valid position
 * @param cloudRows newest downloaded row per dog: one row per slave_id
 * @returns markers sorted by dog, each carrying where its position came from
 *
 * While a Master is connected only the dogs it reports are shown; a dog that
 * exists in the cloud alone stays hidden until the user picks it. Without a
 * connection the cloud copy is the only source, so every dog in it is shown.
 */
export function mergeDogMarkers({ point, samples = [], cloudRows = [],
  now = Date.now(), freshMs = FRESH_MS, maxAgeMs = MAX_AGE_MS }) {
  const local = point?.slaveId == null ? null : (() => {
    const position = latestPosition(point, samples, 'slave', true);
    return position && {
      slaveId: point.slaveId, masterId: point.masterId ?? null,
      coordinate: position.coordinate, receivedAt: position.receivedAt,
      retained: position.retained, source: 'ble',
    };
  })();
  // "Connected" means this phone is still receiving over BLE, not that the
  // Bluetooth adapter is on: a stale row must not hide the cloud copy.
  const connected = !!local && now - local.receivedAt <= freshMs;
  const dogs = new Map();
  if (local) dogs.set(local.slaveId, local);
  for (const row of cloudRows) {
    const position = coordinate(row);
    if (!position || !Number.isFinite(row.received_at)) continue;
    if (connected && row.slave_id !== local.slaveId) continue;
    const current = dogs.get(row.slave_id);
    // A tie keeps the BLE row: it is timed by this phone, while a cloud row
    // carries the Master's clock.
    if (current && current.receivedAt >= row.received_at) continue;
    dogs.set(row.slave_id, {
      slaveId: row.slave_id, masterId: row.master_id ?? null,
      coordinate: position, receivedAt: row.received_at,
      retained: false, source: 'cloud',
    });
  }
  return [...dogs.values()]
    .filter(dog => now - dog.receivedAt <= maxAgeMs)
    .sort((left, right) => left.slaveId - right.slaveId)
    .slice(0, MAX_DOGS);
}

export function describeDogSource(dog) {
  if (dog.source === 'ble') {
    return dog.retained ? 'BLE・最後有效位置，非最新定位' : 'BLE';
  }
  return `經 Master ${dog.masterId ?? '?'}・雲端`;
}
