import { cameraCoordinates, latestPosition } from './TrackingGeometry';
import { DEFAULT_TRACKING_PREFERENCES } from '../tracking/TrackingPreferences';

export const MASTER_RANGE_METERS = 1000;

/**
 * Converts provider-neutral SQLite models into one shared map presentation.
 * Provider renderers must not reinterpret tracking or fallback rules.
 */
export function createTrackingMapPresentation(
  point,
  route,
  positionSamples = [],
  visibility = DEFAULT_TRACKING_PREFERENCES,
) {
  const master = latestPosition(point, positionSamples, 'master', true);
  const slave = latestPosition(point, positionSamples, 'slave', true);
  return {
    // Keep information/camera data available even when both eyes are closed.
    positions: { master, slave },
    cameraPositions: cameraCoordinates(master, slave),
    master: visibility.showMasterMarker ? master : null,
    slave: visibility.showSlaveMarker ? slave : null,
    masterSegments:
      visibility.showTrails && visibility.showMasterMarker
        ? route.masterSegments
        : [],
    slaveSegments:
      visibility.showTrails && visibility.showSlaveMarker
        ? route.slaveSegments
        : [],
    masterRangeMeters: MASTER_RANGE_METERS,
  };
}
