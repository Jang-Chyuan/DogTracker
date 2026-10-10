// Coverage is proof of a completed bounded cloud query, never a count of local
// rows. Both an empty result and a populated result cover the same interval.
export const HISTORY_CONTEXT_BEFORE_MS = 30 * 60000;
export const HISTORY_CONTEXT_AFTER_MS = 2 * 3600000;
export function historyCoverage(dayStart, dayEnd, cutoff) {
  return { range_start: dayStart, range_end: Math.min(dayEnd, cutoff),
    received_before: Math.min(dayEnd + HISTORY_CONTEXT_AFTER_MS, cutoff) };
}
export function coversHistory(row, needed) {
  return !!row?.complete && Number.isFinite(row.range_start) && Number.isFinite(row.range_end)
    && Number.isFinite(row.received_before) && row.range_start <= needed.range_start
    && row.range_end >= needed.range_end && row.received_before >= needed.received_before;
}
export async function initializeHistoryCoverage(connection, table = 'history_download_state') {
  await connection.executeAsync(`CREATE TABLE IF NOT EXISTS ${table} (owner TEXT, slave_id INTEGER, day TEXT,
    complete INTEGER NOT NULL, range_start INTEGER, range_end INTEGER, received_before INTEGER,
    PRIMARY KEY(owner,slave_id,day))`);
  const result = await connection.executeAsync(`PRAGMA table_info(${table})`);
  const columns = new Set((result.results || result.rows?._array || []).map(column => column.name));
  for (const name of ['range_start', 'range_end', 'received_before'])
    if (!columns.has(name)) await connection.executeAsync(`ALTER TABLE ${table} ADD COLUMN ${name} INTEGER`);
}
// Run in the deletion's transaction and use its exact candidate ids. Context
// packets also matter to replay, so their eviction invalidates that proof.
export function invalidateEvictedCoverage(deletion, table = 'supabase_dog_status', coverageTable = 'history_download_state') {
  const candidates = deletion.replace(new RegExp(`^DELETE FROM ${table} WHERE id IN`), '');
  return `UPDATE ${coverageTable} SET complete=0 WHERE complete=1 AND EXISTS (
    SELECT 1 FROM ${table} lost WHERE lost.id IN ${candidates}
    AND lost.owner_user_id=${coverageTable}.owner AND lost.slave_id=${coverageTable}.slave_id
    AND (CAST(COALESCE(lost.track_at,lost.received_at) AS INTEGER)>=range_start-${HISTORY_CONTEXT_BEFORE_MS}
      AND CAST(COALESCE(lost.track_at,lost.received_at) AS INTEGER)<range_end
      OR lost.received_at>=range_start-${HISTORY_CONTEXT_BEFORE_MS} AND lost.received_at<received_before))`;
}

export function coverageContainsTime(time, coverage) {
  return `(${time}>=${coverage}.range_start-${HISTORY_CONTEXT_BEFORE_MS} AND ${time}<${coverage}.range_end)`;
}
export function invalidateRepairedCoverage(owner, eventId, nextTime) {
  return { query: `UPDATE history_download_state SET complete=0 WHERE owner=? AND complete=1 AND EXISTS (
    SELECT 1 FROM supabase_dog_status old WHERE old.owner_user_id=history_download_state.owner
    AND old.slave_id=history_download_state.slave_id AND old.event_id=?
    AND CAST(COALESCE(old.track_at,old.received_at) AS INTEGER)<>?
    AND (${coverageContainsTime('CAST(COALESCE(old.track_at,old.received_at) AS INTEGER)', 'history_download_state')}
      OR ${coverageContainsTime('?', 'history_download_state')}))`,
  params: [owner, eventId, nextTime, nextTime, nextTime] };
}
