import { createDayCache, HISTORY_KEPT_DAYS, HISTORY_KEPT_ROWS } from './HistoryDayCache';
import { createExactHistoryModelCache } from './HistoryExactSnapshot';

// A dog's days seen a moment ago, kept past the history screen's closing
// (2026-10-16): opening the same dog's day again (card → 看軌跡, ‹ ›) found
// nothing kept — #201's caches lived and died with one opening (audit M6) —
// and read, proved and built it all again (seconds on a phone).
//
// The same bounds as while the screen is open, no more: the rows of at most
// HISTORY_DOG_SLOTS dogs (the screen's four colour slots), each HISTORY_KEPT_DAYS
// days within HISTORY_KEPT_ROWS rows (HistoryDayCache), and the built models
// of one view (one entry dog and its company) within the same bounds. A model
// is reused only for the very rows it was built from (by reference: a reader
// hands back its kept rows only when a fresh read found them unchanged) and
// equal options, behind the screen's own gates (fresh rows, the day's proof):
// nothing is shown from here that the screen would not have built.
export const HISTORY_DOG_SLOTS = 4;

// Today's verified view of a dog, kept past the closing (2026-10-17, user):
// reopening today's history (card → 看軌跡) read, proved and downloaded today's
// tail again behind 「下載 10/17 的紀錄…」 and the skeleton (1.8 s on a
// phone), though a past day seen a moment ago shows at once. A view verified
// less than this long ago shows again at once, with 「更新中」 on its summary
// line, while today's newest rows are fetched; an older one waits as before.
// It is shown under #174's rules like a view kept within one opening
// (useHistoryScreen): the same account, publisher and lineage, and only while
// the day's stored proof still covers the cutoff it was verified at (a
// withdrawn proof hides it).
export const HISTORY_TODAY_REUSE_MS = 10 * 60000;

let dogRows = new Map();
let models = null;
let todayView = null;
let todayTimer = null;

/** The rows kept for one dog of one account (most recently used first). */
export function recentDogRows(key) {
  let cache = dogRows.get(key);
  if (cache) dogRows.delete(key);
  else cache = createDayCache({ rowsOf: entry => entry.rows.length + entry.seed.length });
  dogRows.set(key, cache);
  while (dogRows.size > HISTORY_DOG_SLOTS) dogRows.delete(dogRows.keys().next().value);
  return cache;
}

/** The built models kept for one view (another view replaces them). */
export function recentDogModels(view) {
  if (models?.view !== view) models = { view, cache: createExactHistoryModelCache({ days: HISTORY_KEPT_DAYS, rows: HISTORY_KEPT_ROWS }) };
  return models.cache;
}

/**
 * Keeps one view of today (`key`: the dog, the day, the accounts): `entry` is
 * the screen's verified entry, `at` the time its rows are proven up to.
 */
export function rememberTodayView(key, entry, at, now = at) {
  todayView = { key, entry, at };
  // Let go once it is too old to be shown (not only when asked again).
  clearTimeout(todayTimer);
  todayTimer = setTimeout(() => { todayView = null; }, Math.max(0, at + HISTORY_TODAY_REUSE_MS - now));
}

/** Today's view kept for `key`, if it was verified less than HISTORY_TODAY_REUSE_MS before `now`. */
export function recentTodayView(key, now) {
  if (!todayView || todayView.key !== key) return null;
  const age = now - todayView.at;
  if (!(age >= 0 && age < HISTORY_TODAY_REUSE_MS)) {
    todayView = null;
    return null;
  }
  return todayView.entry;
}

/** Lets everything go (sign-out, deleting the dogs' data, tests). */
export function releaseRecentDogs() {
  dogRows = new Map();
  models = null;
  todayView = null;
  clearTimeout(todayTimer);
}

/** For diagnostics and tests: what is kept, by count. */
export function recentDogsSize() {
  let rows = 0;
  for (const cache of dogRows.values()) rows += cache.size;
  return { dogs: dogRows.size, rowDays: rows, modelDays: models?.cache.size ?? 0, today: todayView ? 1 : 0 };
}
