import { t } from '../i18n';
// The readings a dog's open card needs beyond the map's own rows: the dog's
// activity readings of the last hours (both tables, for the 活動量 row) and
// its newest valid battery reading (the 電量 row says how old it is when it is
// older than the position). Only read while a card is open.
import { activityMinutes, activityReadings } from './ActivityMinutes';

// How far back the 活動量 row looks: a rest longer than this reads as
// lasting since this far back.
export const CARD_ACTIVITY_LOOKBACK_MS = 6 * 3600000;

const CLOUD_TIME = 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
const rowsOf = result => result.results || result.rows?._array || [];

/**
 * Raw rows for one dog from dog_status and (signed in) supabase_dog_status.
 * @returns {{ local: row[], cloud: row[], battery: row[] }} rows carry `time`
 *   (received_at or track_at) and `source`; `battery` holds each table's
 *   newest row with a valid battery percentage.
 */
export async function readDogCardRows(db, owner, slaveId, since) {
  if (!Number.isInteger(slaveId) || slaveId < 1 || !Number.isFinite(since)) throw new Error(t("c445"));
  const columns = 'activity, activity_valid, activity_time, master_id, slave_id';
  const local = rowsOf(await db.executeAsync(`SELECT received_at AS time, ${columns}
    FROM dog_status WHERE slave_id=? AND received_at>=? AND activity_valid=1
    ORDER BY received_at`, [slaveId, since]));
  const cloud = owner ? rowsOf(await db.executeAsync(`SELECT ${CLOUD_TIME} AS time, ${columns}
    FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=? AND ${CLOUD_TIME}>=? AND activity_valid=1
    ORDER BY ${CLOUD_TIME}`, [owner, slaveId, since])) : [];
  const battery = [
    ...rowsOf(await db.executeAsync(`SELECT received_at AS time, battery_percentage, usb_present, 'ble' AS source
      FROM dog_status WHERE slave_id=? AND battery_valid=1 AND battery_percentage IS NOT NULL
      ORDER BY received_at DESC LIMIT 1`, [slaveId])),
    ...(owner ? rowsOf(await db.executeAsync(`SELECT ${CLOUD_TIME} AS time, battery_percentage, usb_present,
      'cloud' AS source FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=? AND battery_valid=1
      AND battery_percentage IS NOT NULL ORDER BY ${CLOUD_TIME} DESC LIMIT 1`, [owner, slaveId])) : []),
  ];
  return { local, cloud, battery };
}

/**
 * What the card shows from those rows (pure).
 * @returns {{ activity: { minutes, newestAt }, battery: { percentage,
 *   charging, at } | null }}
 */
export function dogCardReadings({ local = [], cloud = [], battery = [] } = {}, now) {
  const readings = [...activityReadings(local, 'ble'), ...activityReadings(cloud, 'cloud')];
  const minutes = activityMinutes(readings, { now });
  const finished = readings.filter(reading => reading.time < Math.floor(now / 60000) * 60000);
  const newestAt = finished.length ? Math.max(...finished.map(reading => reading.time)) : null;
  let newest = null;
  for (const row of battery) {
    const time = Number(row?.time);
    const percentage = Number(row?.battery_percentage);
    if (!Number.isFinite(time) || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) continue;
    // Equal times: the local copy.
    if (!newest || time > newest.at || (time === newest.at && row.source === 'ble')) {
      newest = { percentage, charging: row.usb_present === 1 || row.usb_present === true, at: time };
    }
  }
  return { activity: { minutes, newestAt }, battery: newest };
}
