// Exact copies of a few values of every item, packed (the map drawing's
// caches: they must notice the hold replay moving earlier fixes of a day in
// place). A plain array per fix cost about 200 bytes for 14 values (boxed
// numbers, array headers); packed, a value is 9 bytes (audit M6,
// 2026-10-15). Compared with ===, as before: NaN never matches (the cache
// builds again), 0 and -0 do.
// `paths` lists each value as [holder, key]: item[key] when holder is null,
// else item[holder][key]. One list per cache (compared by identity).

const UNDEFINED = 0, NULL = 1, TRUE = 2, FALSE = 3, NUMBER = 4, STRING = 5, OTHER = 6;

export function valuePaths(list) {
  return { holders: list.map(([holder]) => holder), keys: list.map(([, key]) => key) };
}

export function takeSnapshot(items, paths) {
  const { holders, keys } = paths;
  const width = keys.length, size = items.length * width;
  const kinds = new Uint8Array(size), numbers = new Float64Array(size);
  const strings = [], stringIds = new Map(), others = new Map();
  let k = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    for (let j = 0; j < width; j += 1, k += 1) {
      const v = (holders[j] === null ? item : item[holders[j]])[keys[j]];
      if (typeof v === 'number') { kinds[k] = NUMBER; numbers[k] = v; }
      else if (typeof v === 'string') {
        let id = stringIds.get(v);
        if (id === undefined) { id = strings.length; strings.push(v); stringIds.set(v, id); }
        kinds[k] = STRING; numbers[k] = id;
      } else if (v === undefined) kinds[k] = UNDEFINED;
      else if (v === null) kinds[k] = NULL;
      else if (v === true) kinds[k] = TRUE;
      else if (v === false) kinds[k] = FALSE;
      else { kinds[k] = OTHER; others.set(k, v); }
    }
  }
  return { paths, count: items.length, kinds, numbers, strings, others };
}

export function sameSnapshot(snapshot, items, paths) {
  if (!snapshot || snapshot.paths !== paths || snapshot.count !== items.length) return false;
  const { holders, keys } = paths;
  const { kinds, numbers, strings, others } = snapshot;
  const width = keys.length;
  let k = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    for (let j = 0; j < width; j += 1, k += 1) {
      const v = (holders[j] === null ? item : item[holders[j]])[keys[j]];
      const kind = kinds[k];
      if (typeof v === 'number') { if (kind !== NUMBER || numbers[k] !== v) return false; }
      else if (typeof v === 'string') { if (kind !== STRING || strings[numbers[k]] !== v) return false; }
      else if (v === undefined) { if (kind !== UNDEFINED) return false; }
      else if (v === null) { if (kind !== NULL) return false; }
      else if (v === true) { if (kind !== TRUE) return false; }
      else if (v === false) { if (kind !== FALSE) return false; }
      else if (kind !== OTHER || others.get(k) !== v) return false;
    }
  }
  return true;
}
