// What the activity page (A4) reads for one dog and one period, from this
// phone's dog_status and (signed in) the downloaded supabase_dog_status.
//
// - 日 reads the raw readings, so the day is judged on exactly the same
//   minutes as the card's 活動量 row (same dedupe key, local copy wins).
// - 週／月／年 would be 100,000s of raw rows (a dog reports ~14,000 a day), so
//   SQLite averages each table per minute and a minute this phone heard wins
//   over the downloaded copy of that minute. The judgement on top is the same.
// Both ask 9 minutes either side of the period: a rest that began just before
// midnight still fills back into the first minutes of the day.
import { activityReadings } from './ActivityMinutes';

const MINUTE = 60000;
export const ACTIVITY_CONTEXT_MS = 9 * MINUTE;
const CLOUD_TIME = 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
const rowsOf = result => result.results || result.rows?._array || [];
const VALID = 'activity_valid=1 AND activity IS NOT NULL AND CAST(activity AS REAL) BETWEEN 0 AND 1';

const check = (slaveId, start, end) => {
  if (!Number.isInteger(slaveId) || slaveId < 1 || slaveId > 255 || !Number.isFinite(start)
    || !Number.isFinite(end) || end <= start) throw new Error('活動量查詢條件無效');
};

/**
 * @param detail 'raw' (日) | 'minute' (週／月／年)
 * @returns {{ local, cloud }} raw rows (activityReadings() input) for 'raw';
 *   {{ minutes }} [{ minute, value, count }] for 'minute'
 */
export async function readActivityPeriod(db, owner, slaveId, { start, end, detail = 'raw' }) {
  check(slaveId, start, end);
  const from = start - ACTIVITY_CONTEXT_MS;
  const to = end + ACTIVITY_CONTEXT_MS;
  if (detail === 'raw') {
    const columns = 'activity, activity_valid, activity_time, master_id, slave_id';
    const local = rowsOf(await db.executeAsync(`SELECT received_at AS time, ${columns}
      FROM dog_status WHERE slave_id=? AND received_at>=? AND received_at<? AND ${VALID}
      ORDER BY received_at`, [slaveId, from, to]));
    const cloud = owner ? rowsOf(await db.executeAsync(`SELECT ${CLOUD_TIME} AS time, ${columns}
      FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=? AND ${CLOUD_TIME}>=? AND ${CLOUD_TIME}<?
      AND ${VALID} ORDER BY ${CLOUD_TIME}`, [owner, slaveId, from, to])) : [];
    return { local, cloud };
  }
  const perMinute = (table, time, extra, params) => db.executeAsync(`SELECT
      CAST(${time} / 60000 AS INTEGER) * 60000 AS minute, AVG(CAST(activity AS REAL)) AS value, COUNT(*) AS count
    FROM ${table} WHERE slave_id=? AND ${time}>=? AND ${time}<? ${extra} AND ${VALID}
    GROUP BY CAST(${time} / 60000 AS INTEGER)`, [slaveId, from, to, ...params]);
  const local = rowsOf(await perMinute('dog_status', 'received_at', '', []));
  const cloud = owner
    ? rowsOf(await perMinute('supabase_dog_status', CLOUD_TIME, 'AND owner_user_id=?', [owner])) : [];
  return { minutes: mergeMinutes(local, cloud) };
}

/** Per-minute rows of both tables: this phone's minute wins. Oldest first. */
export function mergeMinutes(local = [], cloud = []) {
  const minutes = new Map();
  const add = row => {
    const minute = Number(row.minute);
    const value = Number(row.value);
    if (Number.isFinite(minute) && Number.isFinite(value)) {
      minutes.set(minute, { minute, value, count: Number(row.count) || 1 });
    }
  };
  cloud.forEach(add);
  local.forEach(add);
  return [...minutes.values()].sort((left, right) => left.minute - right.minute);
}

/** The dog's first activity reading in either table (‹ stops there), or null. */
export async function readActivityEarliest(db, owner, slaveId) {
  check(slaveId, 0, 1);
  const first = rows => {
    const value = Number(rows[0]?.time);
    return rows[0]?.time != null && Number.isFinite(value) ? value : null;
  };
  const local = first(rowsOf(await db.executeAsync(`SELECT MIN(received_at) AS time FROM dog_status
    WHERE slave_id=? AND ${VALID}`, [slaveId])));
  const cloud = owner ? first(rowsOf(await db.executeAsync(`SELECT MIN(${CLOUD_TIME}) AS time
    FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=? AND ${VALID}`, [owner, slaveId]))) : null;
  const times = [local, cloud].filter(time => time != null);
  return times.length ? Math.min(...times) : null;
}

/** buildActivityView's data input from either answer of readActivityPeriod. */
export function activityViewInput(answer) {
  if (answer?.minutes) return { minutes: answer.minutes };
  return { readings: [...activityReadings(answer?.local, 'ble'), ...activityReadings(answer?.cloud, 'cloud')] };
}

/** 日 reads raw readings, the longer periods per-minute averages. */
export const activityDetail = mode => (mode === 'day' ? 'raw' : 'minute');
