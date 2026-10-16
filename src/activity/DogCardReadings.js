import { t } from '../i18n';
import { chargingSql, isCharging } from '../models/UsbPresent';
// The readings a dog's open card needs beyond the map's own rows: the dog's
// activity readings of the last hours (both tables, for the 活動量 row) and
// its newest believed battery reading (the 電量 row says how old it is when it
// is older than the position). Only read while a card is open.
import { activityMinutes, activityReadings } from './ActivityMinutes';
import { advanceBattery, batteryReading, PLAUSIBLE_BATTERY_SQL } from '../tracking/BatteryPlausibility';

// How far back the 活動量 row reads every time: a rest that reaches back to
// where these rows begin (ActivityMinutes.activityState `over`) is followed
// further back, one CARD_REST_STEP_MS at a time (useDogCardReadings), to find
// where it really began (「休息中・已 8 小時 12 分」).
export const CARD_ACTIVITY_LOOKBACK_MS = 6 * 3600000;
export const CARD_REST_STEP_MS = CARD_ACTIVITY_LOOKBACK_MS;
// How far back a rest is followed at most: past it the row says 「休息中・超過
// 24 小時」. A collar that reports valid, still readings for a whole day is
// not a rest worth timing to the minute (a collar left lying somewhere, or a
// fault), and three more reads at most keep the card light.
export const CARD_REST_MAX_LOOKBACK_MS = 24 * 3600000;
// How many of each table's newest battery readings the 電量 row judges
// (BatteryPlausibility): enough for a sudden drop to be confirmed or not.
export const CARD_BATTERY_ROWS = 20;

const CLOUD_TIME = 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
const rowsOf = result => result.results || result.rows?._array || [];

/**
 * Raw rows for one dog from dog_status and (signed in) supabase_dog_status.
 * With `until`: only the activity rows from `since` up to (not including)
 * `until`, for a rest followed further back; no battery rows.
 * @returns {{ local: row[], cloud: row[], battery: row[], since }} rows carry
 *   `time` (received_at or track_at) and `source`; `since` is where the
 *   activity rows begin (the 活動量 row's lookback edge); `battery` holds each table's
 *   newest CARD_BATTERY_ROWS rows with a valid battery reading that can be
 *   believed on its own (0..100%, 0% only with an empty cell's voltage).
 */
export async function readDogCardRows(db, owner, slaveId, since, until = null) {
  if (!Number.isInteger(slaveId) || slaveId < 1 || !Number.isFinite(since)) throw new Error(t("c445"));
  const bounded = until != null;
  if (bounded && !Number.isFinite(until)) throw new Error(t("c445"));
  // The activity readings, and every row on USB power (充電中: its minutes
  // are not judged, and end a rest; ActivityMinutes).
  const columns = 'activity, activity_valid, activity_time, master_id, slave_id, usb_present';
  const local = rowsOf(await db.executeAsync(`SELECT received_at AS time, ${columns}
    FROM dog_status WHERE slave_id=? AND received_at>=? ${bounded ? 'AND received_at<?' : ''}
    AND (activity_valid=1 OR ${chargingSql()})
    ORDER BY received_at`, bounded ? [slaveId, since, until] : [slaveId, since]));
  const cloud = owner ? rowsOf(await db.executeAsync(`SELECT ${CLOUD_TIME} AS time, ${columns}
    FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=? AND ${CLOUD_TIME}>=?
    ${bounded ? `AND ${CLOUD_TIME}<?` : ''} AND (activity_valid=1 OR ${chargingSql()})
    ORDER BY ${CLOUD_TIME}`, bounded ? [owner, slaveId, since, until] : [owner, slaveId, since])) : [];
  if (bounded) return { local, cloud, battery: [], since, until };
  const battery = [
    ...rowsOf(await db.executeAsync(`SELECT received_at AS time, battery_percentage, battery_mv, usb_present,
      'ble' AS source FROM dog_status WHERE slave_id=? AND battery_valid=1 AND battery_percentage IS NOT NULL
      AND ${PLAUSIBLE_BATTERY_SQL} ORDER BY received_at DESC LIMIT ${CARD_BATTERY_ROWS}`, [slaveId])),
    ...(owner ? rowsOf(await db.executeAsync(`SELECT ${CLOUD_TIME} AS time, battery_percentage, battery_mv, usb_present,
      'cloud' AS source FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=? AND battery_valid=1
      AND battery_percentage IS NOT NULL AND ${PLAUSIBLE_BATTERY_SQL}
      ORDER BY ${CLOUD_TIME} DESC LIMIT ${CARD_BATTERY_ROWS}`, [owner, slaveId])) : []),
  ];
  return { local, cloud, battery, since };
}

/**
 * What the card shows from those rows (pure).
 * @returns {{ activity: { minutes, newestAt, from }, battery: { percentage,
 *   charging, at } | null }} `from`: where the activity rows begin (null when
 *   the reader did not say)
 */
export function dogCardReadings({ local = [], cloud = [], battery = [], since = null } = {}, now) {
  const readings = [...activityReadings(local, 'ble'), ...activityReadings(cloud, 'cloud')];
  const minutes = activityMinutes(readings, { now });
  const finished = readings.filter(reading => reading.time < Math.floor(now / 60000) * 60000);
  const newestAt = finished.length ? Math.max(...finished.map(reading => reading.time)) : null;
  // Both tables in time order (equal times: the local copy first, so the
  // cloud copy of the same reading is the same packet again), judged the way
  // the map judges them: a bad packet keeps the last believed reading.
  const ordered = battery.map(row => ({ row, time: Number(row?.time) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((left, right) => left.time - right.time
      || (left.row.source === 'ble' ? 0 : 1) - (right.row.source === 'ble' ? 0 : 1));
  let state = null, acceptedRow = null;
  for (const { row, time } of ordered) {
    const next = advanceBattery(state, batteryReading({ ...row, battery_valid: 1 }, time));
    if (next.accepted && next.accepted !== state?.accepted) acceptedRow = row;
    state = next;
  }
  const accepted = state?.accepted;
  const newest = accepted ? { percentage: accepted.percentage,
    charging: isCharging(acceptedRow), at: accepted.at } : null;
  return { activity: { minutes, newestAt, from: Number.isFinite(since) ? since : null }, battery: newest };
}
