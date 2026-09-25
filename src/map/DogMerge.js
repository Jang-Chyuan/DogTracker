import { coordinate as toCoordinate } from '../tracking/RouteSamples';

// A slave_id identifies the same dog across the whole team, whichever Master
// received it (confirmed 2026-09-17). The home map therefore shows one marker
// per dog and takes the newest row of all sources.
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
  // The pair's distance belongs to this dog, not to the card as a whole: with
  // several dogs on the map "狗與領犬員距離" cannot say which one it means.
  const distanceMeters = Number.isFinite(point.distanceMeters) ? point.distanceMeters : null;
  const readings = {
    speedKmh: Number.isFinite(point.speedKmh) ? point.speedKmh : null,
    batteryPercentage: point.batteryValid && Number.isFinite(point.batteryPercentage)
      ? point.batteryPercentage : null,
    distanceMeters,
  };
  if (hasFix(direct)) {
    return { ...base, coordinate: direct, receivedAt: point.receivedAt,
      retained: false, ...readings };
  }
  let previous = null;
  for (const sample of samples) {
    if (sample.slaveId !== point.slaveId || !hasFix(sample.slave)) continue;
    if (!previous || (sample.receivedAt ?? 0) > (previous.receivedAt ?? 0)) previous = sample;
  }
  return previous
    ? { ...base, coordinate: previous.slave, receivedAt: previous.receivedAt,
      retained: true, ...readings }
    : null;
}

/**
 * @param point latest BLE row of the connected pair (DogStatus model)
 * @param samples position context rows used to retain the last valid position
 * @param cloudRows newest downloaded row per dog: one row per slave_id
 * @returns markers sorted by dog, each carrying where its position came from
 *
 * Every dog the phone knows about is shown, from both sources at once, each at
 * its newest row (confirmed 2026-09-16, re-confirmed 2026-09-18): a handler
 * wants to see the whole team, not only the dogs of the Master this phone
 * happens to be holding. The source is written on the marker and in the card,
 * and dogs that are not wanted can be hidden one by one.
 */
export function mergeDogMarkers({ point, samples = [], cloudRows = [], packetRows = [],
  now = Date.now(), maxAgeMs = MAX_AGE_MS, windowMs = null }) {
  const local = bleCandidate(point, samples);
  const dogs = new Map();
  if (local) dogs.set(local.slaveId, local);
  for (const row of cloudRows) {
    const position = cloudCoordinate(row);
    const positionTime = row.track_at ?? row.received_at;
    if (!position || !Number.isFinite(positionTime)) continue;
    const current = dogs.get(row.slave_id);
    // Prefer corrected position time so delayed phone uploads cannot displace
    // a newer position. Equal times keep the direct BLE observation.
    if (current && current.receivedAt >= positionTime) continue;
    dogs.set(row.slave_id, {
      slaveId: row.slave_id, masterId: row.master_id ?? null,
      coordinate: position, receivedAt: positionTime,
      retained: false, source: 'cloud',
      // The downloaded row carries these too, so a cloud dog reads the same as
      // a BLE one instead of being a thinner row.
      speedKmh: Number.isFinite(row.speed_kmh) ? row.speed_kmh : null,
      batteryPercentage: Number.isFinite(row.battery_percentage)
        ? row.battery_percentage : null,
    });
  }
  const packets = new Map();
  const observations = [...cloudRows, ...packetRows];
  if (point?.slaveId != null) observations.push({
    slave_id: point.slaveId, master_id: point.masterId, source: 'ble',
    received_at: point.receivedAt, slave_lat: point.slaveLat, slave_lon: point.slaveLon,
    battery_percentage: point.batteryPercentage, battery_valid: point.batteryValid,
    speed_kmh: point.speedKmh, distance_meters: point.distanceMeters,
  });
  for (const row of observations) {
    const time = row.track_at ?? row.received_at;
    if (row.slave_id == null || !Number.isFinite(time) || now - time > maxAgeMs) continue;
    const position = cloudCoordinate(row);
    const source = row.source ?? 'cloud';
    const current = dogs.get(row.slave_id);
    if (position && (!current || time > current.receivedAt || current.receivedAt == null)) {
      dogs.set(row.slave_id, {
        slaveId: row.slave_id, masterId: row.master_id, source,
        coordinate: position, receivedAt: time, retained: false,
      });
    }
    const old = packets.get(row.slave_id);
    if (!old || time > old.time || (time === old.time && source === 'ble')) {
      packets.set(row.slave_id, { row, time, position, source });
    }
    // Explicit status rows can represent a dog that has never obtained a fix.
    if (!dogs.has(row.slave_id) && (packetRows.includes(row) || row.source === 'ble')) {
      dogs.set(row.slave_id, { slaveId: row.slave_id, masterId: row.master_id,
        source, coordinate: null, receivedAt: null, retained: true });
    }
  }
  return [...dogs.values()]
    .filter(dog => now - (packets.get(dog.slaveId)?.time ?? dog.receivedAt) <= maxAgeMs)
    // Retain old positions in the detail list for up to 24 hours. The live map
    // excludes stale markers using the selected window.
    .map(dog => {
      const packet = packets.get(dog.slaveId);
      const lastPacketAt = packet?.time ?? dog.receivedAt;
      const stale = !dog.coordinate || (windowMs != null && now - dog.receivedAt > windowMs);
      const communicating = now - lastPacketAt <= (windowMs ?? 120000);
      const noFix = packet && !packet.position;
      return { ...dog, stale, lastPacketAt, lastPositionAt: dog.receivedAt,
        retained: dog.retained || !!noFix,
        communicationStatus: !communicating ? '未收到新資料'
          : noFix ? '有通訊／GPS 未定位' : '有通訊／定位正常',
        batteryPercentage: packet
          ? (packet.row.battery_valid !== 0 && packet.row.battery_valid !== false
            && Number.isFinite(packet.row.battery_percentage) ? packet.row.battery_percentage : null)
          : dog.batteryPercentage,
        speedKmh: noFix ? null : packet?.row.speed_kmh ?? dog.speedKmh,
        distanceMeters: stale || noFix || packet?.source !== 'ble' ? null
          : packet.row.distance_meters ?? null,
      };
    })
    .sort((left, right) => left.slaveId - right.slaveId)
    .slice(0, MAX_DOGS);
}

export function describeDogSource(dog) {
  if (dog.source === 'ble') {
    return dog.retained ? 'BLE・最後有效位置，非最新定位' : 'BLE';
  }
  return `經 Master ${dog.masterId ?? '?'}・雲端`;
}
