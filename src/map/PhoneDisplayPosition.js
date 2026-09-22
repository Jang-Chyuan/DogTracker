// A small display deadband, not evidence that the device is stationary.
// Compare with the held position so slow, continuous movement eventually escapes.
export function stablePhoneDisplay(previous, point) {
  const next = { latitude: point.latitude, longitude: point.longitude };
  if (!previous || !Number.isFinite(point.rawSpeedKmh) || point.rawSpeedKmh < 0 ||
      point.rawSpeedKmh >= 1 || !Number.isFinite(point.accuracy) || point.accuracy < 0)
    return next;
  const lat = (point.latitude - previous.latitude) * Math.PI / 180;
  const lon = (point.longitude - previous.longitude) * Math.PI / 180;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(previous.latitude * Math.PI / 180)
    * Math.cos(point.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
  const distance = 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
  return distance <= Math.min(3, point.accuracy / 3) ? previous : next;
}
