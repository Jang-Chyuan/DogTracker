import { coordinate as toCoordinate } from '../tracking/RouteSamples';

// A slave_id identifies the same dog across the whole team, whichever Master
// received it (confirmed 2026-09-17). The home map therefore shows one marker
// per dog and takes the newest row of all sources.
export const FRESH_MS = 10 * 60 * 1000;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_DOGS = 20;

// A collar without a GPS fix reports 0,0 (seen on hardware 2026-09-18, with
// battery and speed present). Those are valid numbers, so without this check a
// no-fix row wins on time and drops the dog into the Gulf of Guinea, hiding an
// older row that does know where the dog is.
const hasFix = position => !!position && !(position.latitude === 0 && position.longitude === 0);
const cloudCoordinate = row => {
  const position = toCoordinate(row?.slave_lat, row?.slave_lon);
  return hasFix(position) ? position : null;
};

// The newest BLE row with a fix; older rows of the same dog stand in when the
// latest one has none, and say that they are not the current position.
function bleCandidate(point, samples) {
  if (point?.slaveId == null) return null;
  const base = { slaveId: point.slaveId, masterId: point.masterId ?? null, source: 'ble' };
  const direct = toCoordinate(point.slaveLat, point.slaveLon);
  if (hasFix(direct)) {
    return { ...base, coordinate: direct, receivedAt: point.receivedAt, retained: false };
  }
  let previous = null;
  for (const sample of samples) {
    if (sample.slaveId !== point.slaveId || !hasFix(sample.slave)) continue;
    if (!previous || (sample.receivedAt ?? 0) > (previous.receivedAt ?? 0)) previous = sample;
  }
  return previous
    ? { ...base, coordinate: previous.slave, receivedAt: previous.receivedAt, retained: true }
    : null;
}

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
  const local = bleCandidate(point, samples);
  // "Connected" means this phone is still receiving over BLE, not that the
  // Bluetooth adapter is on: a stale row must not hide the cloud copy. A live
  // row without a fix still counts as connected, so the dogs of other Masters
  // stay hidden while this handler is working.
  const receiving = point?.receivedAt != null && now - point.receivedAt <= freshMs;
  const connected = receiving && point?.slaveId != null;
  const dogs = new Map();
  if (local) dogs.set(local.slaveId, local);
  for (const row of cloudRows) {
    const position = cloudCoordinate(row);
    if (!position || !Number.isFinite(row.received_at)) continue;
    if (connected && row.slave_id !== point.slaveId) continue;
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
