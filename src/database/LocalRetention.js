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
// - all dogs together: 500,000 rows (about 380 MB); a dog is saved at most
//   once a second (one dog, 7 days of 8 hours: 201,600). Above it the oldest
//   rows go first, whichever dog's.
// A dog not heard for longer than the window keeps its newest 10,000 rows
// (the count every dog kept before #198): its last position stays. The cap
// never takes those, nor a dog's newest day.
export const ROUTE_RETENTION_DAYS = 30;
export const ROUTE_RECORD_CAP = 700000;
export const DOG_RETENTION_DAYS = 7;
export const DOG_RECORD_FLOOR = 10000;
export const DOG_TOTAL_CAP = 500000;
export const RETENTION_BATCH = 500;

export const RETENTION_SQL = {
  table: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  nextDog: 'SELECT MIN(slave_id) FROM dog_status WHERE slave_id > ?',
  dogNthNewest: 'SELECT id FROM dog_status WHERE slave_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?',
  dogDelete: 'DELETE FROM dog_status WHERE id IN (SELECT id FROM dog_status WHERE slave_id = ? AND id <= ? AND received_at < ? ORDER BY id LIMIT ?)',
  dogCount: 'SELECT COUNT(*) FROM dog_status',
  dogNewestTime: 'SELECT MAX(received_at) FROM dog_status WHERE slave_id = ?',
  dogOldest: 'SELECT id FROM dog_status WHERE slave_id = ? AND id <= ? AND received_at < ? ORDER BY id LIMIT 1',
  routeNewestId: 'SELECT MAX(id) FROM myLocationTracker',
  routeDelete: 'DELETE FROM myLocationTracker WHERE id IN (SELECT id FROM myLocationTracker WHERE id <= ? AND recorded_at < ? LIMIT ?)',
};

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

async function listDogs(db) {
  const found = [];
  let after = 0;
  for (;;) {
    const slave = firstValue(await db.executeAsync(RETENTION_SQL.nextDog, [after]));
    if (slave == null || slave <= after) return found;
    found.push(slave);
    after = slave;
  }
}

/**
 * What the cap may take of one dog: ids up to `throughId`, times before
 * `before` (never its newest 10,000 rows nor its newest local day); null: none.
 */
async function takeable(db, slave) {
  const throughId = firstValue(await db.executeAsync(RETENTION_SQL.dogNthNewest, [slave, DOG_RECORD_FLOOR]));
  if (throughId == null) return null;
  const newest = firstValue(await db.executeAsync(RETENTION_SQL.dogNewestTime, [slave]));
  if (newest == null) return null;
  return { slave, throughId, before: retentionCutoff(newest, 1) };
}

const oldestTakeable = async (db, limit) =>
  firstValue(await db.executeAsync(RETENTION_SQL.dogOldest, [limit.slave, limit.throughId, limit.before]));

/** Above DOG_TOTAL_CAP rows, the oldest go first (as written), whichever dog's. */
async function capDogs(db) {
  let excess = (firstValue(await db.executeAsync(RETENTION_SQL.dogCount)) ?? 0) - DOG_TOTAL_CAP;
  if (excess <= 0) return 0;
  const oldest = new Map();
  const limits = new Map();
  for (const slave of await listDogs(db)) {
    const limit = await takeable(db, slave);
    const id = limit && await oldestTakeable(db, limit);
    if (id != null) { oldest.set(slave, id); limits.set(slave, limit); }
  }
  let removed = 0;
  while (excess > 0 && oldest.size) {
    const [slave] = [...oldest.entries()].reduce((a, b) => (b[1] < a[1] ? b : a));
    const limit = limits.get(slave);
    const others = [...oldest.entries()].filter(([key]) => key !== slave).map(([, id]) => id);
    const through = others.length ? Math.min(limit.throughId, Math.min(...others) - 1) : limit.throughId;
    const result = await db.executeAsync(RETENTION_SQL.dogDelete,
      [slave, through, limit.before, Math.min(RETENTION_BATCH, excess)]);
    const gone = Number(result?.rowsAffected) || 0;
    removed += gone;
    excess -= gone;
    const again = await oldestTakeable(db, limit);
    if (again == null || gone === 0) oldest.delete(slave); else oldest.set(slave, again);
  }
  return removed;
}

/** The dogs' half of the rule, for the JS fallback (Android: LocalRetention.kt). */
export async function pruneDogStatus(db, now = Date.now()) {
  const cutoff = retentionCutoff(now, DOG_RETENTION_DAYS);
  let removed = 0;
  for (const slave of await listDogs(db)) {
    const floor = firstValue(await db.executeAsync(RETENTION_SQL.dogNthNewest, [slave, DOG_RECORD_FLOOR]));
    if (floor != null) removed += await drain(db, RETENTION_SQL.dogDelete, [slave, floor, cutoff]);
  }
  return removed + await capDogs(db);
}

const later = (a, b) => (a > b ? a : b);

/**
 * The first day each kind of data is kept from, for 「保留到 M/D」: the rule's
 * day, or later when a cap already cut into the window (the oldest kept row's
 * day; for the dogs, the oldest row the cap could still take).
 * Reads only: two rowid ends for the route; for the dogs a count, and at the
 * cap a few indexed seeks per dog.
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
    // At the cap the oldest rows it may take went first: the dogs are kept
    // from the oldest of those still here (a quiet dog's last rows and each
    // dog's newest day are kept whatever their age, and do not count).
    const count = firstValue(await db.executeAsync(RETENTION_SQL.dogCount)) ?? 0;
    if (count >= DOG_TOTAL_CAP) {
      let first = null;
      for (const slave of await listDogs(db)) {
        const limit = await takeable(db, slave);
        const id = limit && await oldestTakeable(db, limit);
        if (id != null && (first == null || id < first)) first = id;
      }
      const oldest = first == null ? null
        : firstValue(await db.executeAsync('SELECT received_at FROM dog_status WHERE id = ?', [first]));
      if (oldest != null) dogs.from = later(dogs.from, dayKey(new Date(oldest)));
    }
  }
  return { route, dogs };
}
