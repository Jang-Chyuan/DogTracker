import { t } from '../i18n';
import { coordinate as toCoordinate } from '../tracking/RouteSamples';
import { ridesAlong } from '../placement/RideAlong';
import { advanceBattery, batteryReading, plausibleBattery } from '../tracking/BatteryPlausibility';
import { isCharging } from '../models/UsbPresent';

// A slave_id identifies the same dog across the whole team, whichever Master
// received it (confirmed 2026-09-17). The home map therefore shows one marker
// per dog and takes the newest row of all sources.
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// How many dogs the map draws before it starts leaving some out. It only
// ever leaves out dogs that are not heard by this phone and whose last packet
// is more than MAX_AGE_MS old (rankDogs): a lent collar or a test ID from last
// week, never a dog that is working today. The cloud roster itself is bounded
// in time (CloudLatest ROSTER_WINDOW_MS), so this is a safety net for marker
// count, not the usual limit.
export const MAX_DOGS = 20;
export const LIVE_PACKET_WINDOW_MS = 3 * 60000;

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
    batteryPercentage: point.batteryValid && plausibleBattery(point.batteryPercentage, point.batteryMillivolts)
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
//
// A dog stays on the map however old its last position is (v3 §6: older than
// 24 hours it is kept, grey); pass `maxAgeMs` only to limit what is read.
// Past MAX_DOGS, only dogs this phone does not hear and that have been silent
// for over 24 hours are left out (keepDogs); the cloud only lists dogs heard
// in the last ROSTER_WINDOW_MS to begin with (CloudLatest).
export function mergeDogMarkers({ point, samples = [], cloudRows = [], packetRows = [],
  now = Date.now(), maxAgeMs = Infinity, windowMs = null, holds = {}, statuses = {}, ride = null, batteries = {} }) {
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
      batteryPercentage: plausibleBattery(row.battery_percentage, row.battery_mv)
        && row.battery_valid !== 0 && row.battery_valid !== false ? row.battery_percentage : null,
    });
  }
  const packets = new Map();
  const environments = new Map();
  for (const row of packetRows) {
    const result = row.environment;
    const old = environments.get(row.slave_id);
    if (result && (!old || result.observedAt > old.observedAt
      || (result.observedAt === old.observedAt && row.source === 'ble'))) {
      environments.set(row.slave_id, result);
    }
  }
  const observations = [...cloudRows, ...packetRows];
  if (point?.slaveId != null) observations.push({
    slave_id: point.slaveId, master_id: point.masterId, source: 'ble',
    received_at: point.receivedAt, slave_lat: point.slaveLat, slave_lon: point.slaveLon,
    battery_percentage: point.batteryPercentage, battery_valid: point.batteryValid,
    battery_mv: point.batteryMillivolts,
    speed_kmh: point.speedKmh, distance_meters: point.distanceMeters,
    satellites: point.satellites, hdop: point.hdop, rssi: point.rssi, snr: point.snr,
    usb_present: point.usbPresent,
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
    if (!old || time > old.time || (time === old.time && source === 'ble' && !old.row.environment)) {
      packets.set(row.slave_id, { row, time, position, source });
    }
    // Explicit status rows can represent a dog that has never obtained a fix.
    if (!dogs.has(row.slave_id) && (packetRows.includes(row) || row.source === 'ble')) {
      dogs.set(row.slave_id, { slaveId: row.slave_id, masterId: row.master_id,
        source, coordinate: null, receivedAt: null, retained: true });
    }
  }
  const merged = [...dogs.values()]
    .filter(dog => now - (packets.get(dog.slaveId)?.time ?? dog.receivedAt) <= maxAgeMs)
    // Retain old positions in the detail list for up to 24 hours. The live map
    // excludes stale markers using the selected window.
    .map(dog => {
      const packet = packets.get(dog.slaveId);
      const lastPacketAt = packet?.time ?? dog.receivedAt;
      const communicating = now - lastPacketAt <= (windowMs ?? LIVE_PACKET_WINDOW_MS);
      const environment = environments.get(dog.slaveId) ?? null;
      // Indoors the dog is drawn where it was last seen clearly (IndoorHold),
      // never at a hand-entered point. A charging collar keeps that place after
      // its packets stop, as the set point used to.
      // The collar's own USB flag on the newest packet (UsbPresent.isCharging,
      // the same rule as the card's 活動量 row and A4; 2026-10-16). The
      // environment model's usb_rule is not used here any more: it only reads
      // the same flag from the raw payload when every packet of its window has
      // it, which the stored column already carries.
      const charging = isCharging(packet?.row);
      // Riding in the handler's vehicle beats a hold at the place it got in.
      // The dog is simply drawn where it is, with nothing said about it: it is
      // where the handler expects it, not a state to point out.
      const hold = ridesAlong(statuses[dog.slaveId], ride, now)
        ? { coordinate: ride.coordinate, reason: null, source: 'ride', since: lastPacketAt }
        : holds[dog.slaveId] ?? null;
      // A hold outlives the packets (v3: a dog held indoors that falls silent
      // keeps its house and turns grey after 10 minutes; DogFreshness times
      // it by its packets). HoldStore forgets a dog unheard for 24 hours.
      const held = hold;
      const positionAt = held ? held.anchorAt ?? lastPacketAt : dog.receivedAt;
      const stale = !(held || dog.coordinate) || (!communicating && !charging);
      const noFix = packet && !packet.position;
      // The newest packet's battery, judged with the dog's earlier readings
      // (HoldStore over the same rows; BatteryPlausibility): a bad packet
      // (0% without an empty cell, a sudden unconfirmed drop) keeps the last
      // believed reading and its time. None when the packet has no valid one.
      const reading = packet ? batteryReading(packet.row, packet.time) : null;
      const batteryState = reading ? advanceBattery(batteries?.[dog.slaveId] ?? null, reading) : null;
      return { ...dog, ...(held ? { coordinate: held.coordinate, heldReason: held.reason,
        heldSince: held.since, heldSource: held.source,
        // Where the history's 室內 node of this hold starts (HoldStore.step).
        heldFrom: Number.isFinite(held.from) ? held.from : held.since,
        // The live rows begin inside the hold (a cold start sees half an
        // hour): it may have begun before heldFrom.
        ...(held.fromClipped && Number.isFinite(held.from) ? { heldFromClipped: true } : {}),
        receivedAt: lastPacketAt } : {}),
        stale, lastPacketAt, lastPositionAt: positionAt,
        // For DogFreshness: the newest valid position and the newest packet,
        // each with the source it came from (the phone's receiver or cloud).
        fixAt: dog.coordinate ? dog.receivedAt : null,
        fixSource: dog.coordinate ? dog.source : null,
        packetAt: packet?.time ?? (dog.coordinate ? dog.receivedAt : null),
        packetSource: packet?.source ?? (dog.coordinate ? dog.source : null),
        charging,
        environment,
        retained: held ? false : dog.retained || !!noFix,
        communicationStatus: !communicating ? t("c735")
          : noFix ? t("c736") : t("c737"),
        batteryPercentage: packet ? batteryState?.accepted?.percentage ?? null : dog.batteryPercentage,
        // When that reading came (older than the packet when this one was not believed).
        batteryAt: packet ? batteryState?.accepted?.at ?? null
          : Number.isFinite(dog.batteryPercentage) ? dog.receivedAt : null,
        batteryState,
        speedKmh: held || noFix ? null : packet?.row.speed_kmh ?? dog.speedKmh,
        distanceMeters: held || stale || noFix || packet?.source !== 'ble' ? null
          : packet.row.distance_meters ?? null,
      };
    });
  return keepDogs(merged, now, point?.slaveId ?? null)
    .sort((left, right) => left.slaveId - right.slaveId);
}

// A dog this phone hears itself: the connected pair, or a packet or fix that
// came over this phone's receiver.
const isLocal = (dog, liveSlaveId) => dog.slaveId === liveSlaveId
  || dog.packetSource === 'ble' || dog.fixSource === 'ble' || dog.source === 'ble';

/**
 * Which merged dogs the map keeps (audit F4: the old `.slice(0, MAX_DOGS)`
 * after sorting by ID dropped the highest IDs, the live BLE dog among them,
 * once old roster dogs passed 20). Ranked: this phone's own dogs first, then
 * dogs heard in the last MAX_AGE_MS, then the rest by their last packet. The
 * first two tiers are always kept, however many; only the third is cut, to
 * what is left of MAX_DOGS.
 */
export function keepDogs(dogs, now, liveSlaveId = null) {
  if (dogs.length <= MAX_DOGS) return dogs;
  const lastHeard = dog => dog.lastPacketAt ?? dog.receivedAt ?? -Infinity;
  const tier = dog => isLocal(dog, liveSlaveId) ? 0 : now - lastHeard(dog) <= MAX_AGE_MS ? 1 : 2;
  const ranked = dogs.map(dog => ({ dog, tier: tier(dog), heard: lastHeard(dog) }))
    .sort((left, right) => left.tier - right.tier || right.heard - left.heard
      || left.dog.slaveId - right.dog.slaveId);
  const always = ranked.filter(entry => entry.tier < 2).length;
  return ranked.slice(0, Math.max(always, MAX_DOGS)).map(entry => entry.dog);
}
