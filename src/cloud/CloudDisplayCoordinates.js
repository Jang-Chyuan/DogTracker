import { smoothCloudHistory } from '../mapHistory/SmoothCloudHistory';

const rows = result => result.results || result.rows?._array || [];
const pending = new WeakMap();

// Keep a late download from changing predecessors between the read and save.
export function withCloudDisplayLock(db, work) {
  const result = (pending.get(db) || Promise.resolve()).then(work);
  pending.set(db, result.catch(() => {}));
  return result;
}

// Materialize only the requested page, with raw predecessor context outside
// the visible time window. Each account/Master/Slave has its own smoothing stream.
export async function persistCloudDisplayCoordinates(db, page, owner, ble = false) {
  const table = ble ? 'dog_status' : 'supabase_dog_status';
  const ownerFilter = ble ? '' : 'owner_user_id=? AND ';
  const ownerParams = ble ? [] : [owner];
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
    const context = rows(await db.executeAsync(`SELECT id, received_at AS time,
      slave_lat AS latitude, slave_lon AS longitude, speed_kmh, master_id
      FROM ${table} WHERE ${ownerFilter}master_id IS ? AND slave_id IS ?
      AND (received_at < ? OR (received_at=? AND id < ?))
      ORDER BY received_at DESC, id DESC LIMIT 2`,
    [...ownerParams, first.master_id, first.slave_id, first.time, first.time, first.id])).reverse();
    const smoothed = smoothCloudHistory([...context, ...group]).slice(context.length);
    group.forEach((point, index) => {
      if (point.display_version === 1) { output.set(point.id, point); return; }
      const value = smoothed[index];
      commands.push({
        query: `UPDATE ${table} SET display_latitude=?, display_longitude=?, display_version=1
          WHERE ${ownerFilter}id=? AND display_version IS NULL`,
        params: [value.latitude, value.longitude, ...ownerParams, point.id],
      });
      output.set(point.id, { ...point, display_latitude: value.latitude,
        display_longitude: value.longitude, display_version: 1 });
    });
  }
  if (commands.length) await db.executeBatchAsync(commands);
  return page.map(point => {
    const saved = output.get(point.id);
    return { ...saved, raw_latitude: point.latitude, raw_longitude: point.longitude,
      display_source: ble ? 'ble-smoothed-v1' : 'cloud-smoothed-v1',
      latitude: saved.display_latitude, longitude: saved.display_longitude };
  });
}
