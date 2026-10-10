import { smoothCloudHistory } from '../mapHistory/SmoothCloudHistory';
import { withConnectionLock } from '../database/connectionLock';

const rows = result => result.results || result.rows?._array || [];

// Lazy migration and three-point smoothing (SmoothCloudHistory) of the live
// rows; the cloud copy keeps no display cache (retired 2026-10-09). Native BLE writes
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
  return withConnectionLock(db, async () => {
    await ensureBleDisplayColumns(db);
    const page = [...records].sort((a, b) => a.received_at - b.received_at || a.id - b.id)
      .map(row => ({ ...row, time: row.received_at, latitude: row.slave_lat, longitude: row.slave_lon }));
    const saved = await persistBleDisplayCoordinates(db, page);
    const byId = new Map(saved.map(row => [row.id, row]));
    return records.map(row => ({ ...row,
      display_latitude: byId.get(row.id).latitude, display_longitude: byId.get(row.id).longitude,
      display_version: 1 }));
  });
}

// Materialize only the requested page, with raw predecessor context outside
// the visible time window. Each Master/Slave has its own smoothing stream.
export async function persistBleDisplayCoordinates(db, page) {
  const groups = new Map();
  for (const point of page) {
    const key = `${point.master_id}:${point.slave_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  const commands = [];
  const output = new Map();
  for (const group of groups.values()) {
    if (group.every(point => point.display_version === 1)) {
      for (const point of group) output.set(point.id, point);
      continue;
    }
    const first = group[0];
    const fields = `id, received_at AS time,
      slave_lat AS latitude, slave_lon AS longitude, speed_kmh, master_id`;
    // ANALYZE can turn the OR cursor into two scans plus a sort of the whole
    // stream. Bound each half first; merge at most four rows for the two seeds.
    const context = rows(await db.executeAsync(`SELECT * FROM (
      SELECT ${fields} FROM dog_status
      WHERE master_id IS ? AND slave_id IS ? AND received_at=? AND id<?
      ORDER BY id DESC LIMIT 2
    ) UNION ALL SELECT * FROM (
      SELECT ${fields} FROM dog_status
      WHERE master_id IS ? AND slave_id IS ? AND received_at<?
      ORDER BY received_at DESC, id DESC LIMIT 2
    ) ORDER BY time DESC, id DESC LIMIT 2`,
    [first.master_id, first.slave_id, first.time, first.id,
      first.master_id, first.slave_id, first.time])).reverse();
    const smoothed = smoothCloudHistory([...context, ...group]).slice(context.length);
    group.forEach((point, index) => {
      if (point.display_version === 1) { output.set(point.id, point); return; }
      const value = smoothed[index];
      commands.push({
        query: `UPDATE dog_status SET display_latitude=?, display_longitude=?, display_version=1
          WHERE id=? AND display_version IS NULL`,
        params: [value.latitude, value.longitude, point.id],
      });
      output.set(point.id, { ...point, display_latitude: value.latitude,
        display_longitude: value.longitude, display_version: 1 });
    });
  }
  // Display values are a resumable cache. Release the native store monitor
  // between chunks so BLE/location writes can proceed.
  for (let offset = 0; offset < commands.length; offset += 50) {
    await db.executeBatchAsync(commands.slice(offset, offset + 50));
  }
  return page.map(point => {
    const saved = output.get(point.id);
    return { ...saved, raw_latitude: point.latitude, raw_longitude: point.longitude,
      display_source: 'ble-smoothed-v1',
      latitude: saved.display_latitude, longitude: saved.display_longitude };
  });
}
