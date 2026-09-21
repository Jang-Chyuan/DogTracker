import { persistCloudDisplayCoordinates, withCloudDisplayLock } from '../cloud/CloudDisplayCoordinates';

// Same lazy migration and smoothing policy as cloud history. Native BLE writes
// keep their original fields; display columns are materialized when read.
export async function ensureBleDisplayColumns(db) {
  const result = await db.executeAsync('PRAGMA table_info(dog_status)');
  const columns = new Set((result.results || result.rows?._array || []).map(row => row.name));
  for (const [name, type] of [['display_latitude', 'REAL'], ['display_longitude', 'REAL'], ['display_version', 'INTEGER']]) {
    if (!columns.has(name)) await db.executeAsync(`ALTER TABLE dog_status ADD COLUMN ${name} ${type}`);
  }
  await db.executeAsync('CREATE INDEX IF NOT EXISTS idx_ble_display_stream ON dog_status(master_id, slave_id, received_at, id)');
  // Applies to both JS and native writers, including a phone clock adjustment.
  await db.executeAsync(`CREATE TRIGGER IF NOT EXISTS invalidate_ble_display_after_insert
    AFTER INSERT ON dog_status BEGIN
      UPDATE dog_status SET display_version=NULL, display_latitude=NULL, display_longitude=NULL
      WHERE id IN (SELECT id FROM dog_status WHERE master_id IS NEW.master_id AND slave_id IS NEW.slave_id
        AND (received_at > NEW.received_at OR (received_at=NEW.received_at AND id>NEW.id))
        ORDER BY received_at,id LIMIT 2);
    END`);
}

export async function bleDisplayRows(db, records) {
  if (!records.length) return records;
  return withCloudDisplayLock(db, async () => {
    await ensureBleDisplayColumns(db);
    const page = [...records].sort((a, b) => a.received_at - b.received_at || a.id - b.id)
      .map(row => ({ ...row, time: row.received_at, latitude: row.slave_lat, longitude: row.slave_lon }));
    const saved = await persistCloudDisplayCoordinates(db, page, null, true);
    const byId = new Map(saved.map(row => [row.id, row]));
    return records.map(row => ({ ...row,
      display_latitude: byId.get(row.id).latitude, display_longitude: byId.get(row.id).longitude,
      display_version: 1 }));
  });
}
