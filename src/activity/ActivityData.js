import { t } from '../i18n';
// What the activity page (A4) reads for one dog and one period, from this
// phone's dog_status and (signed in) the downloaded supabase_dog_status.
//
// - 日 reads the raw readings, so the day is judged on exactly the same
//   minutes as the card's 活動量 row (same dedupe key, local copy wins).
// - 週／月／年 would be 100,000s of raw rows (a dog reports ~14,000 a day), so
//   SQLite sums each minute's readings, leaving out a downloaded reading that
//   is a copy of one this phone heard (same key as the card's dedupe), and the
//   mean of both tables is the minute's value. The judgement on top is the same.
// Both ask 9 minutes either side of the period: a rest that began just before
// midnight still fills back into the first minutes of the day.
import { activityReadings } from './ActivityMinutes';

const MINUTE = 60000;
export const ACTIVITY_CONTEXT_MS = 9 * MINUTE;
const CLOUD_TIME = 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
const CLOUD_TIME_C = 'CAST(COALESCE(c.track_at, c.received_at) AS INTEGER)';
const rowsOf = result => result.results || result.rows?._array || [];
const VALID = 'activity_valid=1 AND activity IS NOT NULL AND CAST(activity AS REAL) BETWEEN 0 AND 1';

const check = (slaveId, start, end) => {
  if (!Number.isInteger(slaveId) || slaveId < 1 || slaveId > 255 || !Number.isFinite(start)
    || !Number.isFinite(end) || end <= start) throw new Error(t("c433"));
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
  // This phone's minutes, and the downloaded readings that are not a copy of
  // one of this phone's (the readingKey of ActivityMinutes: the collar's
  // activity_time with the receiver, else the time to the millisecond).
  // Copies are looked for within 2 minutes, so the index on
  // dog_status(slave_id, received_at) keeps the lookup short.
  const local = rowsOf(await db.executeAsync(`SELECT CAST(received_at / 60000 AS INTEGER) * 60000 AS minute,
      SUM(CAST(activity AS REAL)) AS sum, COUNT(*) AS count
    FROM dog_status WHERE slave_id=? AND received_at>=? AND received_at<? AND ${VALID}
    GROUP BY CAST(received_at / 60000 AS INTEGER)`, [slaveId, from, to]));
  const cloud = owner ? rowsOf(await db.executeAsync(`SELECT CAST(t / 60000 AS INTEGER) * 60000 AS minute,
      SUM(v) AS sum, COUNT(*) AS count FROM (
      SELECT ${CLOUD_TIME_C} AS t, CAST(c.activity AS REAL) AS v FROM supabase_dog_status c
      WHERE c.owner_user_id=? AND c.slave_id=? AND ${CLOUD_TIME_C}>=? AND ${CLOUD_TIME_C}<?
        AND c.activity_valid=1 AND c.activity IS NOT NULL AND CAST(c.activity AS REAL) BETWEEN 0 AND 1
        AND NOT EXISTS (SELECT 1 FROM dog_status l WHERE l.slave_id=c.slave_id
          AND l.received_at BETWEEN ${CLOUD_TIME_C} - 120000 AND ${CLOUD_TIME_C} + 120000
          AND l.activity_valid=1 AND l.activity IS NOT NULL AND CAST(l.activity AS REAL) BETWEEN 0 AND 1
          AND ((c.activity_time IS NOT NULL AND c.activity_time<>'' AND l.activity_time=c.activity_time
                AND l.master_id IS c.master_id)
            OR ((c.activity_time IS NULL OR c.activity_time='') AND (l.activity_time IS NULL OR l.activity_time='')
                AND l.received_at=${CLOUD_TIME_C})))
    ) GROUP BY CAST(t / 60000 AS INTEGER)`, [owner, slaveId, from, to])) : [];
  return { minutes: mergeMinutes(local, cloud) };
}

/**
 * Per-minute sums of both tables (copies already left out of `cloud`): one
 * mean per minute over every reading, as activityMinutes() averages them.
 * Oldest first.
 */
export function mergeMinutes(local = [], cloud = []) {
  const minutes = new Map();
  const add = row => {
    const minute = Number(row.minute);
    const sum = Number(row.sum);
    const count = Number(row.count);
    if (!Number.isFinite(minute) || !Number.isFinite(sum) || !(count > 0)) return;
    const old = minutes.get(minute) || { sum: 0, count: 0 };
    minutes.set(minute, { sum: old.sum + sum, count: old.count + count });
  };
  local.forEach(add);
  cloud.forEach(add);
  return [...minutes.entries()].sort((left, right) => left[0] - right[0])
    .map(([minute, { sum, count }]) => ({ minute, value: sum / count, count }));
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
