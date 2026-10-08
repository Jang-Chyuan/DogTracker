import { useEffect, useMemo, useRef, useState } from 'react';
import { expireHistory, HISTORY_DEFAULTS } from './HistoryDatabase';

/**
 * The stored history query (the old export reads it until 056, and the dogs'
 * names live in it), the receivers that heard each dog, and the day readers
 * of the history screen. `active` is true while the history is on screen.
 * The old query card's day list, cloud day walk and draft preview went with
 * the card: the date row and calendar (useHistoryScreen, useHistoryCloud)
 * and 資料來源 replaced them.
 */
export function useMapHistory(database, ready, active, owner) {
  const db = useRef(null);
  const saving = useRef(false);
  const lastRead = useRef(null);
  const [preferences, setPreferences] = useState(HISTORY_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [ownedDevices, setOwnedDevices] = useState({ owner: null, value: [] });
  const devices = ownedDevices.owner === (owner || null) ? ownedDevices.value : [];
  const [clock, setClock] = useState(Date.now);
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
  const key = JSON.stringify(preferences) + ':' + (owner || '');
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    if (!active || preferences.timeMode === 'fixed') return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, preferences.timeMode]);
  const data = useMemo(() => expireHistory(result?.key === key ? result.value : null,
    preferences, Math.max(clock, Date.now())), [result, key, preferences, clock]);
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
  useEffect(() => {
    if (!loaded || !active) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const value = await db.current.read(preferences, owner, Date.now(), () => alive,
          false, null);
        if (alive) {
          lastRead.current = { key, at: Date.now() };
          setResult({ key, value }); setError('');
        }
      } catch (e) { if (alive) setError(e.message); }
      finally { if (alive) timer = setTimeout(poll, 10000); }
    }
    // A short background transition can reuse the result still on the map.
    // Do not start another full window scan earlier than the normal cadence.
    const delay = lastRead.current?.key === key
      ? Math.max(0, 10000 - (Date.now() - lastRead.current.at)) : 0;
    if (delay) timer = setTimeout(poll, delay);
    else poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [loaded, active, preferences, owner, key]);
  return {
    preferences, loaded, error, busy, key, devices,
    data,
    /** One day of one dog's or this phone's rows for the time-line list. */
    readDay: readDay.current,
    /** The local days with rows of one dog or my route (HistoryDatabase.historyDays). */
    readDays: readDays.current,
    async exportRows() {
      if (!data) throw new Error('請等待歷史資料載入');
      const alive = () => currentKey.current === key && !!db.current;
      const value = await db.current.read(preferences, owner, Date.now(), alive, true,
        { since: data.since, until: data.until });
      if (!alive()) throw new Error('帳號或篩選條件已變更，請重新匯出');
      if (value.message) throw new Error(value.message);
      return value;
    },
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
