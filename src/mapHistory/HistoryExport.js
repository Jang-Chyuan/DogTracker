import { coordinate } from '../tracking/RouteSamples';
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const iso = time => new Date(time).toISOString();
const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
export function serializeHistory(format, data) {
  // One named track per dog, so an export of several dogs stays readable.
  const tracks = [['phone', data.phone],
    ...(data.clients || []).map(entry => [`dog-${entry.slaveId}`, entry.rows])];
  if (format === 'csv') {
    const lines = ['source,id,recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees,raw_latitude,raw_longitude,session_id,raw_speed_kmh,speed_accuracy_mps,motion_state,display_source,display_location_at'];
    for (const [source, points] of tracks) for (const p of points) lines.push([
      source, p.id, iso(p.time), p.location_at == null ? '' : iso(p.location_at), p.latitude, p.longitude,
      p.accuracy_meters, p.altitude_meters, p.speed_kmh, p.heading_degrees, p.raw_latitude, p.raw_longitude, p.session_id,
      p.raw_speed_kmh, p.speed_accuracy_mps, p.motion_state,
      p.display_source, p.display_location_at == null ? '' : iso(p.display_location_at),
    ].map(cell).join(','));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  if (format !== 'gpx') throw new Error('不支援的匯出格式');
  const output = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="DogTracker" xmlns="http://www.topografix.com/GPX/1/1" xmlns:dt="https://dogtracker.local/gpx/1">',
    `<metadata><desc>${xml(iso(data.since) + ' / ' + iso(data.until))}</desc></metadata>`];
  for (const [source, points] of tracks) {
    output.push(`<trk><name>${source}</name>`);
    let last = null, open = false;
    for (const p of points) {
      const valid = !!coordinate(p.latitude, p.longitude);
      if (!valid || (last && (p.session_id !== last.session_id || p.time - last.time > 120000 || Math.abs(p.longitude - last.longitude) > 180))) {
        if (open) output.push('</trkseg>');
        open = false; last = null;
      }
      if (!valid) continue;
      if (!open) { output.push('<trkseg>'); open = true; }
      output.push(`<trkpt lat="${p.latitude}" lon="${p.longitude}">${p.altitude_meters == null ? '' : `<ele>${p.altitude_meters}</ele>`}<time>${iso(p.location_at ?? p.time)}</time><extensions>${p.accuracy_meters == null ? '' : `<dt:accuracy_meters>${p.accuracy_meters}</dt:accuracy_meters>`}${p.speed_kmh == null ? '' : `<dt:speed_kmh>${p.speed_kmh}</dt:speed_kmh>`}</extensions></trkpt>`);
      last = p;
    }
    if (open) output.push('</trkseg>');
    output.push('</trk>');
  }
  output.push('</gpx>');
  return output.join('\n');
}
