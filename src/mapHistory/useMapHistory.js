import { useEffect, useMemo, useRef, useState } from 'react';
import { expireHistory, HISTORY_DEFAULTS } from './HistoryDatabase';

export function useMapHistory(database, ready, foreground, owner) {
  const db = useRef(null);
  const saving = useRef(false);
  const [preferences, setPreferences] = useState(HISTORY_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [clock, setClock] = useState(Date.now);
  const key = JSON.stringify(preferences) + ':' + (owner || '');
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    if (!foreground || !preferences.enabled || preferences.timeMode === 'fixed') return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [foreground, preferences.enabled, preferences.timeMode]);
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
    if (!loaded || !foreground || !preferences.enabled) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const value = await db.current.read(preferences, owner, Date.now(), () => alive);
        if (alive) { setResult({ key, value }); setError(''); }
      } catch (e) { if (alive) setError(e.message); }
      finally { if (alive) timer = setTimeout(poll, 10000); }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [loaded, foreground, preferences, owner, key]);
  return {
    preferences, loaded, error, busy, key,
    data,
    async exportRows() {
      if (!data) throw new Error('請等待歷史資料載入');
      const alive = () => currentKey.current === key && !!db.current;
      const value = await db.current.read(preferences, owner, Date.now(), alive, true,
        { since: data.since, until: data.until });
      if (!alive()) throw new Error('帳號或篩選條件已變更，請重新匯出');
      if (value.message) throw new Error(value.message);
      return value;
    },
    async save(value) {
      if (!db.current || saving.current) return;
      saving.current = true; setBusy(true);
      try { setPreferences(await db.current.save(value)); setError(''); setLoaded(true); }
      catch (e) { setError(e.message); }
      finally { saving.current = false; setBusy(false); }
    },
  };
}
