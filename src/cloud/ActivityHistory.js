export const ACTIVITY_HISTORY_HOURS = 8;
export const ACTIVITY_HISTORY_MINUTES = ACTIVITY_HISTORY_HOURS * 60;

export async function readActivityHistory(db, owner, slaveId, now = Date.now()) {
  if (!Number.isInteger(slaveId) || slaveId < 1 || slaveId > 255 || !Number.isFinite(now)) throw new Error('活動量查詢條件無效');
  const start = Math.floor(now / 60000) * 60000 - (ACTIVITY_HISTORY_MINUTES - 1) * 60000;
  const read = async (table, time, extra, params) => {
    const result = await db.executeAsync(`SELECT CAST(${time} / 60000 AS INTEGER) AS minute,
      AVG(CAST(activity AS REAL)) AS value, COUNT(*) AS count FROM ${table}
      WHERE slave_id=? AND ${time}>=? AND ${time}<=? ${extra}
      AND activity_valid=1 AND activity IS NOT NULL AND CAST(activity AS REAL) BETWEEN 0 AND 1
      GROUP BY minute`, [slaveId, start, now, ...params]);
    return result.results || result.rows?._array || [];
  };
  const local = await read('dog_status', 'received_at', '', []);
  const cloud = owner ? await read('supabase_dog_status', 'CAST(COALESCE(track_at, received_at) AS INTEGER)',
    'AND owner_user_id=?', [owner]) : [];
  const minutes = new Map(cloud.map(row => [row.minute, { ...row, source: 'cloud' }]));
  for (const row of local) minutes.set(row.minute, { ...row, source: 'ble' });
  return Array.from({ length: ACTIVITY_HISTORY_MINUTES }, (_, i) => {
    const time = start + i * 60000, row = minutes.get(time / 60000);
    return { time, value: row?.value ?? null, count: row?.count ?? 0, source: row?.source ?? null };
  });
}
