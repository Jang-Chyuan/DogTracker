import { toRouteSample } from '../tracking/RouteSamples';
export { buildSegments } from '../tracking/RouteSegments';

// Camera framing includes the reference circle, not only two nearby markers.
export function cameraCoordinates(master, slave) {
  const result = [master?.coordinate, slave?.coordinate].filter(Boolean);
  const center = master?.coordinate || slave?.coordinate;
  if (!center) return result;
  const latDelta = 1000 / 111195;
  const lonDelta =
    latDelta / Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  for (const direction of [-1, 1])
    result.push({
      latitude: Math.max(
        -90,
        Math.min(90, center.latitude + direction * latDelta),
      ),
      longitude: ((center.longitude + direction * lonDelta + 540) % 360) - 180,
    });
  return result;
}

export function latestPosition(point, samples, role, retainLastValid) {
  const latest = toRouteSample(point);
  if (latest[role])
    return {
      coordinate: latest[role],
      receivedAt: point.receivedAt,
      retained: false,
    };
  if (!retainLastValid) return null;
  let previous = null;
  for (const sample of samples) {
    if (
      sample.id <= point.id &&
      sample[role] &&
      sample[`${role}Id`] === point[`${role}Id`] &&
      (!previous || sample.id > previous.id)
    )
      previous = sample;
  }
  return previous
    ? {
        coordinate: previous[role],
        receivedAt: previous.receivedAt,
        retained: true,
      }
    : null;
}
