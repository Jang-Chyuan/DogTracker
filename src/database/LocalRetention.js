import { dayKey } from '../history/screen/HistoryScreenDates';

// How long this phone keeps its own data (#198). The Android writer prunes
// (android/.../LocalRetention.kt, the same numbers and statements; jest checks
// they agree); this module gives the settings their 「保留到 M/D」 and runs
// the same rule for the JS fallback (DogDatabase without the native owner).
//
// Both count whole local days, today included: 30 days of my route keeps
// 9/16 00:00 onwards on 10/15. Under each, a safety cap of rows (#198 的估算:
// 每筆路線約 250 B、每筆狗資料約 770 B):
// - my route: 700,000 rows (about 180 MB). A recording saves a row every
//   5 s at walking speed (17,280 a day around the clock: 30 days are 518,400
//   rows), every second only above 20 km/h.
// - each dog: 200,000 rows (about 150 MB); a dog is saved at most once a
//   second (7 days of 8 hours are 201,600).
// A dog not heard for longer than the window keeps its newest 10,000 rows
// (the count every dog kept before #198): its last position stays.
export const ROUTE_RETENTION_DAYS = 30;
export const ROUTE_RECORD_CAP = 700000;
export const DOG_RETENTION_DAYS = 7;
export const DOG_RECORD_FLOOR = 10000;
export const DOG_RECORD_CAP = 200000;
export const RETENTION_BATCH = 500;

export const RETENTION_SQL = {
  table: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  nextDog: 'SELECT MIN(slave_id) FROM dog_status WHERE slave_id > ?',
  dogNthNewest: 'SELECT id FROM dog_status WHERE slave_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?',
  dogDelete: 'DELETE FROM dog_status WHERE id IN (SELECT id FROM dog_status WHERE slave_id = ? AND id <= ? AND received_at < ? LIMIT ?)',
  routeNewestId: 'SELECT MAX(id) FROM myLocationTracker',
  routeDelete: 'DELETE FROM myLocationTracker WHERE id IN (SELECT id FROM myLocationTracker WHERE id <= ? AND recorded_at < ? LIMIT ?)',
};

// Above every real time and id (Kotlin binds Long.MAX_VALUE).
const ALL = Number.MAX_SAFE_INTEGER;

/** The first instant kept: local midnight `days` − 1 days before `now`'s day. */
export function retentionCutoff(now, days) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (days - 1)).getTime();
}

/** The first day kept by the rule (「YYYY-MM-DD」, the phone's time zone). */
export function retentionStartDay(now, days) {
  return dayKey(new Date(retentionCutoff(now, days)));
}

const rowsOf = result => result?.results || result?.rows?._array || [];
const firstValue = result => {
  const row = rowsOf(result)[0];
  const value = row ? Object.values(row)[0] : null;
  return value == null ? null : Number(value);
};

async function drain(db, sql, params) {
  let total = 0;
  for (;;) {
    const result = await db.executeAsync(sql, [...params, RETENTION_BATCH]);
    const removed = Number(result?.rowsAffected) || 0;
    total += removed;
    if (removed < RETENTION_BATCH) return total;
  }
}

/** The dogs' half of the rule, for the JS fallback (Android: LocalRetention.kt). */
export async function pruneDogStatus(db, now = Date.now()) {
  const cutoff = retentionCutoff(now, DOG_RETENTION_DAYS);
  let removed = 0;
  let after = 0;
  for (;;) {
    const slave = firstValue(await db.executeAsync(RETENTION_SQL.nextDog, [after]));
    if (slave == null || slave <= after) return removed;
    after = slave;
    const capped = firstValue(await db.executeAsync(RETENTION_SQL.dogNthNewest, [slave, DOG_RECORD_CAP]));
    if (capped != null) removed += await drain(db, RETENTION_SQL.dogDelete, [slave, capped, ALL]);
    const floor = firstValue(await db.executeAsync(RETENTION_SQL.dogNthNewest, [slave, DOG_RECORD_FLOOR]));
    if (floor != null) removed += await drain(db, RETENTION_SQL.dogDelete, [slave, floor, cutoff]);
  }
}

const later = (a, b) => (a > b ? a : b);

/**
 * The first day each kind of data is kept from, for 「保留到 M/D」: the rule's
 * day, or later when a cap already cut into the window (the oldest kept row's
 * day; with several dogs, the latest of those of the dogs at their cap).
 * Reads only: two rowid ends for the route, one indexed seek per dog.
 */
export async function readLocalRetention(db, now = Date.now()) {
  const route = { days: ROUTE_RETENTION_DAYS, from: retentionStartDay(now, ROUTE_RETENTION_DAYS) };
  const dogs = { days: DOG_RETENTION_DAYS, from: retentionStartDay(now, DOG_RETENTION_DAYS) };
  const has = async name => rowsOf(await db.executeAsync(RETENTION_SQL.table, [name])).length > 0;
  if (await has('myLocationTracker')) {
    const ends = rowsOf(await db.executeAsync('SELECT MIN(id) AS low, MAX(id) AS high FROM myLocationTracker'))[0];
    if (ends?.low != null && Number(ends.high) - Number(ends.low) + 1 >= ROUTE_RECORD_CAP) {
      const oldest = firstValue(await db.executeAsync(
        'SELECT recorded_at FROM myLocationTracker WHERE id = ?', [Number(ends.low)]));
      if (oldest != null) route.from = later(route.from, dayKey(new Date(oldest)));
    }
  }
  if (await has('dog_status')) {
    let after = 0;
    for (;;) {
      const slave = firstValue(await db.executeAsync(RETENTION_SQL.nextDog, [after]));
      if (slave == null || slave <= after) break;
      after = slave;
      const oldest = firstValue(await db.executeAsync(
        'SELECT received_at FROM dog_status WHERE slave_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?',
        [slave, DOG_RECORD_CAP - 1]));
      if (oldest != null) dogs.from = later(dogs.from, dayKey(new Date(oldest)));
    }
  }
  return { route, dogs };
}
