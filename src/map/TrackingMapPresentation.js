import { cameraCoordinates, latestPosition } from './TrackingGeometry';
import { DEFAULT_TRACKING_PREFERENCES } from '../tracking/TrackingPreferences';
import { MAX_AGE_MS } from './DogMerge';
import {
  circleCoordinates, distanceMeters, RANGE, RANGE_STATUS, ringEdgePoint,
} from '../tracking/ReceiverRange';

export const MASTER_RANGE_METERS = RANGE.radiusM;

// Drawn points carry their own time (see RouteSegments), so a window change
// clips the cached line instead of rereading SQLite. A piece is time-ordered,
// so clipping keeps its tail, plus the point where the line crosses into the
// window. That crossing has to be computed: the line has already been
// simplified, so a straight or stationary stretch keeps no vertex anywhere near
// the boundary, and using the previous vertex as-is would draw a line starting
// hours before the chosen window. The interpolated point is display geometry
// only — the same rule as SimplifyRoute, never used for distance or export.
function crossing(before, after, since) {
  const span = after.time - before.time;
  if (!(span > 0)) return null;
  const ratio = (since - before.time) / span;
  return {
    latitude: before.latitude + (after.latitude - before.latitude) * ratio,
    longitude: before.longitude + (after.longitude - before.longitude) * ratio,
    time: since,
  };
}

export function clipSegments(segments, since) {
  const clipped = [];
  for (const segment of segments) {
    const inside = segment.findIndex(
      point => !Number.isFinite(point.time) || point.time >= since,
    );
    if (inside < 0) continue;
    const kept = segment.slice(inside);
    if (inside > 0) {
      const entry = crossing(segment[inside - 1], segment[inside], since);
      if (entry) kept.unshift(entry);
    }
    if (kept.length > 1) clipped.push(kept);
  }
  return clipped;
}

// Keep the last position for details for up to 24 hours. Expired positions
// are excluded from live markers and camera framing below.
function withAge(position, since, now) {
  if (!position) return null;
  const age = Number.isFinite(position.receivedAt) ? now - position.receivedAt : null;
  if (age != null && age > MAX_AGE_MS) return null;
  return { ...position, stale: Number.isFinite(position.receivedAt) && position.receivedAt < since };
}

/**
 * Converts provider-neutral SQLite models into one shared map presentation.
 * Provider renderers must not reinterpret tracking or fallback rules.
 *
 * The receiver itself is not drawn (v3: no marker, name tag or track); its
 * position stays in `positions` for the card and the range ring.
 */
export function createTrackingMapPresentation(
  point,
  route,
  positionSamples = [],
  visibility = DEFAULT_TRACKING_PREFERENCES,
  now = Date.now(),
) {
  const windowMs = (visibility.windowMinutes ?? DEFAULT_TRACKING_PREFERENCES.windowMinutes) * 60000;
  const since = now - windowMs;
  const master = withAge(latestPosition(point, positionSamples, 'master', true), since, now);
  const slave = withAge(latestPosition(point, positionSamples, 'slave', true), since, now);
  const trails = visibility.showTrails;
  return {
    // Keep information/camera data available even when both eyes are closed.
    positions: { master, slave },
    cameraPositions: cameraCoordinates(master?.stale ? null : master, slave?.stale ? null : slave),
    slave: visibility.showSlaveMarker && !slave?.stale ? slave : null,
    slaveSegments:
      trails && visibility.showSlaveMarker
        ? clipSegments(route.slaveSegments, since)
        : [],
    rangeRing: null,
    rangeLines: [],
  };
}

// Receiver links (ReceiverState.receiverLink) during which this phone is
// connected to its receiver.
const CONNECTED_LINKS = new Set(['receiving', 'quiet']);

/**
 * The 1 km receiver range ring, or null. Drawn only while this phone is
 * connected to its receiver and that receiver has a position; never while
 * disconnected, connecting, switched off or with cloud data only, and it
 * cannot be turned off. `receiverPosition` must already be this receiver's
 * (another receiver's stored position is filtered out before).
 */
export function receiverRangeRing(receiverPosition, link) {
  if (!CONNECTED_LINKS.has(link) || !receiverPosition?.coordinate) return null;
  const center = receiverPosition.coordinate;
  return {
    center,
    radiusMeters: MASTER_RANGE_METERS,
    // The ring is a dashed outline; Android draws dashes on polygons only.
    coordinates: circleCoordinates(center, MASTER_RANGE_METERS),
  };
}

/**
 * The red dashed lines from the ring's edge to each drawn dog that is out of
 * range (判定表「圈外的紅色虛線」): only with a ring, only for a dog whose
 * judgement is out (a dog without new positions keeps the judgement of its
 * last one), only while the position drawn for it is really outside the ring
 * (a dog walking back, or a receiver that walked up to its last position, gets
 * no line though it is still out), and never for a dog held in place.
 */
export function outOfRangeLines(ring, dogs = [], ranges = {}) {
  if (!ring) return [];
  const lines = [];
  for (const dog of dogs) {
    if (!dog?.coordinate || dog.heldReason) continue;
    if (ranges[dog.slaveId]?.status !== RANGE_STATUS.OUT) continue;
    if (distanceMeters(ring.center, dog.coordinate) <= ring.radiusMeters) continue;
    const edge = ringEdgePoint(ring.center, dog.coordinate, ring.radiusMeters);
    if (edge) lines.push({ slaveId: dog.slaveId, coordinates: [edge, dog.coordinate] });
  }
  return lines;
}
