// 手動改過的範圍這一天會記住 (hist.txt「範圍」, flow.txt「再次進入」): the
// range a user dragged, per dog (or my route) and local day, kept while the
// app runs. Times, not minutes of the day (判定表「換時區」); a range whose
// end follows now keeps only its start.
const memory = new Map();
// Old days are forgotten past this many entries (oldest first).
const MAX_ENTRIES = 60;

/** { start, end, following } remembered for `key`, or null. */
export function rememberedRange(key) {
  return memory.get(key) ?? null;
}

/** Remembers a dragged range ({ start, end, following }) for `key`. */
export function rememberRangeFor(key, range) {
  memory.delete(key);
  memory.set(key, { start: range.start, end: range.following ? null : range.end, following: !!range.following });
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
}

/** Forgets the range of `key` (it no longer holds a minute of fixes). */
export function forgetRange(key) {
  memory.delete(key);
}

/** Tests only. */
export function forgetRanges() {
  memory.clear();
}
