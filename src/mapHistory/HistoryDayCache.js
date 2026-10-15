// How many days the history screen keeps besides the one shown, so that
// coming back to one of them (‹ then ›) shows it at once instead of a
// skeleton and does not build it again. A day's model, rows and hold pass
// are large on a long day (about 18 MB at 14,000 rows, about 100 MB at the
// 80,000-row cap of my route: audit M6, 2026-10-15), so the days kept are
// also bounded by their rows: two long days, or three ordinary ones. The day
// shown is always kept, whatever its size.
export const HISTORY_KEPT_DAYS = 3;
export const HISTORY_KEPT_ROWS = 30000;

/**
 * A small most-recent-first cache of a few days. `rowsOf(entry)` is what an
 * entry costs; the newest entry always stays, the others while there are at
 * most `days` of them and their rows (the newest's included) fit in `rows`.
 * `find` marks an entry as used; `peek` (for a render) does not.
 */
export function createDayCache({ days = HISTORY_KEPT_DAYS, rows = HISTORY_KEPT_ROWS, rowsOf = () => 0 } = {}) {
  let entries = [];
  const trim = () => {
    let total = 0;
    entries = entries.filter((entry, index) => {
      const cost = rowsOf(entry);
      if (index > 0 && (index >= days || total + cost > rows)) return false;
      total += cost;
      return true;
    });
  };
  return {
    peek: match => entries.find(match) ?? null,
    find(match) {
      const index = entries.findIndex(match);
      if (index < 0) return null;
      const [entry] = entries.splice(index, 1);
      entries.unshift(entry);
      return entry;
    },
    /** Adds `entry` as the newest, first dropping every entry `replaces` matches. */
    put(entry, replaces = () => false) {
      entries = [entry, ...entries.filter(old => old !== entry && !replaces(old))];
      trim();
      return entry;
    },
    remove(match) { entries = entries.filter(entry => !match(entry)); },
    clear() { entries = []; },
    get size() { return entries.length; },
    get rows() { return entries.reduce((sum, entry) => sum + rowsOf(entry), 0); },
  };
}
