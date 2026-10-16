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

let dogRows = new Map();
let models = null;

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

/** Lets everything go (sign-out, deleting the dogs' data, tests). */
export function releaseRecentDogs() {
  dogRows = new Map();
  models = null;
}

/** For diagnostics and tests: what is kept, by count. */
export function recentDogsSize() {
  let rows = 0;
  for (const cache of dogRows.values()) rows += cache.size;
  return { dogs: dogRows.size, rowDays: rows, modelDays: models?.cache.size ?? 0 };
}
