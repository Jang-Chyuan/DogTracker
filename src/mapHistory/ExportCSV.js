import { activeSubjects, packetTime, rawCoordinate } from './ExportData';
export const CSV_COLUMNS = 'source,id,recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees,raw_latitude,raw_longitude,session_id,raw_speed_kmh,speed_accuracy_mps,motion_state,display_source,display_location_at,master_id,slave_id,satellites,hdop,rssi,snr'.split(',');
const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
const iso = time => time == null ? '' : new Date(time).toISOString();
export function buildCSV(snapshot) {
  // 判定表「停在原處期間的歷史資料」: a packet without an original fix is no
  // CSV row (it still makes the dog count as having data in the range).
  const entries = activeSubjects(snapshot).flatMap(subject => (subject.rows || [])
    .filter(row => packetTime(row) >= snapshot.since && packetTime(row) <= snapshot.until && rawCoordinate(row, subject))
    .map(row => ({ subject, row })));
  entries.sort((a, b) => packetTime(a.row) - packetTime(b.row) || (a.subject.slaveId ?? -1) - (b.subject.slaveId ?? -1));
  const lines = entries.map(({ subject, row }) => {
    const p = rawCoordinate(row, subject);
    const has = key => Object.prototype.hasOwnProperty.call(row, key);
    const values = { ...row, source: subject.kind === 'phone' ? 'phone' : `dog-${subject.slaveId}`,
      recorded_at: iso(packetTime(row)), location_at: iso(row.location_at), display_location_at: iso(row.display_location_at),
      latitude: p?.latitude, longitude: p?.longitude, slave_id: row.slave_id ?? subject.slaveId,
      // A dog's raw columns are its collar fix (as main wrote slave_lat there).
      raw_latitude: subject.kind === 'phone' || has('raw_latitude') ? row.raw_latitude : p?.latitude,
      raw_longitude: subject.kind === 'phone' || has('raw_longitude') ? row.raw_longitude : p?.longitude };
    if (subject.kind === 'phone') for (const key of ['master_id', 'slave_id', 'satellites', 'hdop', 'rssi', 'snr']) values[key] = '';
    return CSV_COLUMNS.map(key => cell(values[key])).join(',');
  });
  return '\uFEFF' + [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
}
