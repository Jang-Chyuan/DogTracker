import { createDayCache } from './HistoryDayCache';

// Compare the full input, including own undefined fields. History normalization
// distinguishes absent raw/quality fields from fields explicitly set undefined.
// Arrays (a day's rows: thousands) are compared index by index, holes kept
// apart from undefined, without listing their keys.
export function sameHistoryInput(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if ((i in a) !== (i in b) || !sameHistoryInput(a[i], b[i])) return false;
    }
    return true;
  }
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(a);
  return keys.length === Reflect.ownKeys(b).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameHistoryInput(a[key], b[key]));
}

export function copyHistoryInput(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) Object.defineProperty(copy, key, {
    value: copyHistoryInput(value[key]), writable: true,
    enumerable: Object.prototype.propertyIsEnumerable.call(value, key), configurable: key !== 'length',
  });
  return copy;
}

const sameParts = (a, b) => a.length === b.length && a.every((part, i) => Object.is(part, b[i]));

/**
 * The models accepted for one view identity (account, publisher scope and
 * generation, opening, reader): a model is reused only for the very same
 * rows and hold pass (by reference: a reader hands back its kept rows only
 * when a fresh read found them exactly unchanged) and equal options (the
 * day, range, clock...). `days`/`rows` bound how many days' models stay
 * (HistoryDayCache); another identity drops them all. The cache sits behind
 * the screen's own gates (fresh rows, durable completeness): it never shows
 * a model, it only saves building one again.
 */
export function createExactHistoryModelCache({ days = 1, rows = Infinity } = {}) {
  let identityKept = null;
  const kept = createDayCache({ days, rows, rowsOf: entry => entry.rows });
  const sameSubjects = (a, b) => a.length === b.length && a.every((subject, index) => {
    const old = b[index];
    return subject.id === old.id && subject.subject === old.subject
      && subject.rows === old.rows && subject.replayHolds === old.replayHolds;
  });
  const cache = (identity, subjects, options, build) => {
    if (!identityKept || !sameParts(identity, identityKept)) { kept.clear(); identityKept = identity; }
    const hit = kept.find(entry => sameSubjects(subjects, entry.subjects) && sameHistoryInput(options, entry.options));
    if (hit) return hit.value;
    const value = build();
    const sameDay = entry => entry.options.dayStart === options.dayStart && entry.options.dayEnd === options.dayEnd;
    kept.put({ subjects: subjects.map(({ id, subject, rows: list, replayHolds }) => ({ id, subject, rows: list, replayHolds })),
      options: copyHistoryInput(options), value,
      rows: subjects.reduce((sum, subject) => sum + (subject.rows?.length ?? 0), 0) }, sameDay);
    return value;
  };
  cache.clear = () => { kept.clear(); identityKept = null; };
  Object.defineProperty(cache, 'size', { get: () => kept.size });
  return cache;
}
