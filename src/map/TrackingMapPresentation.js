import { cameraCoordinates, latestPosition } from './TrackingGeometry';
import { DEFAULT_TRACKING_PREFERENCES } from '../tracking/TrackingPreferences';
import { MAX_AGE_MS } from './DogMerge';

export const MASTER_RANGE_METERS = 1000;

// Drawn points carry their own time (see RouteSegments), so a window change
// clips the cached line instead of rereading SQLite. A piece is time-ordered,
// so clipping keeps its tail plus the last point before the window: the line
// has already been simplified, so no vertex sits exactly on the boundary, and
// without that anchor a path that merely crosses into the window would vanish.
// The anchor can therefore start the line slightly before the window.
function clipSegments(segments, since) {
  const clipped = [];
  for (const segment of segments) {
    const inside = segment.findIndex(
      point => !Number.isFinite(point.time) || point.time >= since,
    );
    if (inside < 0) continue;
    const kept = segment.slice(Math.max(0, inside - 1));
    if (kept.length > 1) clipped.push(kept);
  }
  return clipped;
}

// Confirmed 2026-09-16: a position older than the window but inside 24 hours
// stays on the map, faded and labelled, without its path; older than that it
// leaves the home map altogether and belongs to the history page.
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
    cameraPositions: cameraCoordinates(master, slave),
    master: visibility.showMasterMarker ? master : null,
    slave: visibility.showSlaveMarker ? slave : null,
    masterSegments:
      trails && visibility.showMasterMarker
        ? clipSegments(route.masterSegments, since)
        : [],
    slaveSegments:
      trails && visibility.showSlaveMarker
        ? clipSegments(route.slaveSegments, since)
        : [],
    windowMinutes: visibility.windowMinutes ?? DEFAULT_TRACKING_PREFERENCES.windowMinutes,
    masterRangeMeters: MASTER_RANGE_METERS,
  };
}
