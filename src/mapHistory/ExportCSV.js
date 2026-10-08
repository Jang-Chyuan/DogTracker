import { activeSubjects, exportRows, gpsTime, packetTime, rawCoordinate } from './ExportData';
export const CSV_COLUMNS = 'source,id,recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees,raw_latitude,raw_longitude,session_id,raw_speed_kmh,speed_accuracy_mps,motion_state,display_source,display_location_at,master_id,slave_id,satellites,hdop,rssi,snr'.split(',');
const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
const iso = time => time == null ? '' : new Date(time).toISOString();
export function buildCSV(snapshot) {
  const entries = activeSubjects(snapshot).flatMap(subject => exportRows(subject, snapshot).filter(rawCoordinate).map(row => ({ subject, row })));
  entries.sort((a, b) => gpsTime(a.row) - gpsTime(b.row) || (a.subject.slaveId ?? -1) - (b.subject.slaveId ?? -1));
  const lines = entries.map(({ subject, row }) => {
    const p = rawCoordinate(row);
    const values = { ...row, source: subject.kind === 'phone' ? 'phone' : `dog-${subject.slaveId}`,
      recorded_at: iso(packetTime(row)), location_at: iso(row.location_at), display_location_at: iso(row.display_location_at),
      latitude: p.latitude, longitude: p.longitude, slave_id: row.slave_id ?? subject.slaveId };
    if (subject.kind === 'phone') for (const key of ['master_id', 'slave_id', 'satellites', 'hdop', 'rssi', 'snr']) values[key] = '';
    return CSV_COLUMNS.map(key => cell(values[key])).join(',');
  });
  return '\uFEFF' + [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
}
