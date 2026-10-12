// Compare the full input, including own undefined fields. History normalization
// distinguishes absent raw/quality fields from fields explicitly set undefined.
export function sameHistoryInput(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.prototype && proto !== null && !Array.isArray(a)) return false;
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

// One accepted model only: no cross-owner/day cache, and no stale model can
// bypass the screen's fresh rows and durable completeness gates.
export function createExactHistoryModelCache() {
  let accepted = null;
  return (identity, subjects, options, build) => {
    const sameSubjects = accepted?.subjects.length === subjects.length
      && subjects.every((subject, index) => {
        const old = accepted.subjects[index];
        return subject.id === old.id && subject.subject === old.subject
          && subject.rows === old.rows && subject.replayHolds === old.replayHolds;
      });
    if (accepted && identity.length === accepted.identity.length && identity.every((part, i) => Object.is(part, accepted.identity[i])) && sameSubjects
      && sameHistoryInput(options, accepted.options)) return accepted.value;
    const value = build();
    accepted = { identity, subjects, options: copyHistoryInput(options), value };
    return value;
  };
}
