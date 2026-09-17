const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const iso = time => new Date(time).toISOString();
const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
export function serializeHistory(format, data) {
  const tracks = [['phone', data.phone], ['client', data.client]];
  if (format === 'csv') {
    const lines = ['source,id,recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees'];
    for (const [source, points] of tracks) for (const p of points) lines.push([
      source, p.id, iso(p.time), p.location_at == null ? '' : iso(p.location_at), p.latitude, p.longitude,
      p.accuracy_meters, p.altitude_meters, p.speed_kmh, p.heading_degrees,
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
      const valid = Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
      if (!valid || (last && (p.time - last.time > 120000 || Math.abs(p.longitude - last.longitude) > 180))) {
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
