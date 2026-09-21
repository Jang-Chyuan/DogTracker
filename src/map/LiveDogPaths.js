import { cloudTracks, dogColor, GAP_MS } from './CloudTracks';
import { clipSegments } from './TrackingMapPresentation';

// Source ownership is per dog, independent of the globally newest BLE packet.
export function liveDogPaths(route, cloudRows, since, now) {
  const paths = new Map(cloudTracks(cloudRows, { since }).map(track =>
    [track.slaveId, { ...track, source: 'cloud' }]));
  for (const track of route.dogTracks || []) {
    if (track.latestValid == null || now - track.latestValid > GAP_MS || track.latestValid < since) continue;
    paths.set(track.slaveId, { slaveId: track.slaveId, source: 'ble',
      segments: clipSegments(track.segments, since) });
  }
  return [...paths.values()].map(track => ({ ...track, color: dogColor(track.slaveId) }));
}
