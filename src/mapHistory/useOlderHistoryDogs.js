import { useEffect, useState } from 'react';

// A stable empty list: no older dogs to offer.
const NO_DOGS = Object.freeze([]);

/**
 * The dogs the history's 「＋ 加入」 offers beside the dogs on the live map:
 * the other dogs this phone holds rows of (`knownDogs`,
 * HistoryDatabase.historyDogs) that have rows on the day shown (`checkDay`,
 * useHistoryScreen). The live map only lists dogs heard in the last 14 days
 * (CloudLatest ROSTER_WINDOW_MS); the history still reaches older ones on the
 * days they have rows. Returns their IDs, ascending; none until checked.
 */
export function useOlderHistoryDogs({ active, knownDogs, mapDogIds, checkDay, day }) {
  const onMap = new Set(mapDogIds);
  const olderKey = active
    ? (knownDogs ?? []).filter(id => Number.isInteger(id) && id > 0 && !onMap.has(id))
      .sort((left, right) => left - right).join(',')
    : '';
  const key = `${day}|${olderKey}`;
  const [found, setFound] = useState({ key: null, ids: NO_DOGS });
  useEffect(() => {
    if (!olderKey || !checkDay) return undefined;
    let alive = true;
    const ids = olderKey.split(',').map(Number);
    Promise.all(ids.map(id => Promise.resolve(checkDay(id))
      .then(value => (value === true ? id : null)).catch(() => null)))
      .then(list => { if (alive) setFound({ key, ids: list.filter(id => id != null) }); });
    return () => { alive = false; };
  }, [key, olderKey, checkDay]);
  return olderKey && found.key === key ? found.ids : NO_DOGS;
}
