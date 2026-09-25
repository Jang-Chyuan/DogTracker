// A display animation can lag a fix by a few seconds, but must not substitute
// a distant pre-resume coordinate. Keep the stored source data intact.
export function safePhoneHistoryCoordinate(point) {
  if (!Number.isFinite(point.pipeline_latitude) || !Number.isFinite(point.pipeline_longitude)) return point;
  const radians = Math.PI / 180;
  const lat = (point.latitude - point.pipeline_latitude) * radians;
  const lon = (point.longitude - point.pipeline_longitude) * radians;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(point.latitude * radians)
    * Math.cos(point.pipeline_latitude * radians) * Math.sin(lon / 2) ** 2;
  const distance = 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
  // Conservative allowance above 3 seconds at the pipeline's 70 m/s ceiling.
  if (Number.isFinite(distance) && distance <= 300 + (point.accuracy_meters || 0)) return point;
  return { ...point, latitude: point.pipeline_latitude, longitude: point.pipeline_longitude,
    display_source: 'pipeline-recovered', display_location_at: point.location_at };
}
