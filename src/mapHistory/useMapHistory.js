import { useEffect, useRef, useState } from 'react';
import { HISTORY_DEFAULTS } from './HistoryDatabase';

/**
 * The stored history preferences (whom the history was opened for, the dogs'
 * names), the receivers that heard each dog,
 * and the day readers of the history screen. `active` is true while the
 * history is on screen. The old query card's day list, cloud day walk and
 * draft preview went with the card (055b); the old query read every 10 s
 * for the old export went with it in 056 (the export uses the screen's own
 * day rows: useHistoryExport).
 */
export function useMapHistory(database, ready, active, owner) {
  const db = useRef(null);
  const saving = useRef(false);
  const [preferences, setPreferences] = useState(HISTORY_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ownedDevices, setOwnedDevices] = useState({ owner: null, value: [] });
  const devices = ownedDevices.owner === (owner || null) ? ownedDevices.value : [];
  // Stable across renders (the list's polling effect depends on it); signing
  // in or out changes `owner` in the request, not the function.
  const readDay = useRef(request => {
    if (!db.current?.historyDayRows) return Promise.resolve({ rows: [], seed: [], after: {} });
    return db.current.historyDayRows(request);
  });
  // The days holding one dog's (or my route's) rows, for the date row.
  const readDays = useRef(request => {
    if (!db.current?.historyDays) return Promise.resolve([]);
    return db.current.historyDays(request);
  });
  const source = preferences.source;
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    db.current = database;
    database.load().then(value => { if (alive) { setPreferences(value); setLoaded(true); } })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; db.current = null; };
  }, [ready, database]);
  useEffect(() => {
    if (!loaded || !active) return undefined;
    let alive = true;
    const account = owner || null;
    // The receivers that heard each dog (看軌跡 exports from all of them).
    db.current?.listDevices(source, owner)
      .then(value => { if (alive) setOwnedDevices({ owner: account, value }); })
      .catch(() => { if (alive) setOwnedDevices({ owner: account, value: [] }); });
    return () => { alive = false; };
  }, [loaded, active, source, owner]);
  return {
    preferences, loaded, error, busy, devices,
    /** One day of one dog's or this phone's rows for the time-line list. */
    readDay: readDay.current,
    /** The local days with rows of one dog or my route (HistoryDatabase.historyDays). */
    readDays: readDays.current,
    // Resolves true only when the value was stored, so a caller that moves on
    // afterwards (the card's 看軌跡) never lands on the old query.
    async save(value) {
      if (!db.current || saving.current) return false;
      saving.current = true; setBusy(true);
      try { setPreferences(await db.current.save(value)); setError(''); setLoaded(true); return true; }
      catch (e) { setError(e.message); return false; }
      finally { saving.current = false; setBusy(false); }
    },
  };
}
