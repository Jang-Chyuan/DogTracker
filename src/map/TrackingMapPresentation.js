import { cameraCoordinates, latestPosition } from './TrackingGeometry';
import { DEFAULT_TRACKING_PREFERENCES } from '../tracking/TrackingPreferences';
import { MAX_AGE_MS } from './DogMerge';

export const MASTER_RANGE_METERS = 1000;

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
    master: visibility.showMasterMarker && !master?.stale ? master : null,
    slave: visibility.showSlaveMarker && !slave?.stale ? slave : null,
    masterSegments:
      trails && visibility.showMasterMarker
        ? clipSegments(route.masterSegments, since)
        : [],
    slaveSegments:
      trails && visibility.showSlaveMarker
        ? clipSegments(route.slaveSegments, since)
        : [],
    masterRangeMeters: MASTER_RANGE_METERS,
  };
}
