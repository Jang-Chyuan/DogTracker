import { useEffect, useMemo, useRef, useState } from 'react';
import { expireHistory, HISTORY_DEFAULTS } from './HistoryDatabase';
import { listCloudDays, mergeDays } from './CloudDays';
import { getCloudClient } from '../cloud/CloudClient';

/** `active` is true while the history tab is the visible screen. */
export function useMapHistory(database, ready, active, owner) {
  const db = useRef(null);
  const saving = useRef(false);
  const [preferences, setPreferences] = useState(HISTORY_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [devices, setDevices] = useState([]);
  const [days, setDays] = useState([]);
  // The cloud day counts are one request per day, so they land a moment after
  // the local ones; the card says so instead of quietly growing a row of chips.
  const [daysLoading, setDaysLoading] = useState(false);
  // Set when the cloud stopped answering before the walk was done, so the card
  // does not present a short list as the whole story.
  const [daysIncomplete, setDaysIncomplete] = useState('');
  // The day list is only worth asking for once the card opens the section that
  // shows it; entering the tab should not spend requests nobody asked for.
  const [daysWanted, setDaysWanted] = useState(false);
  const [phoneRecorded, setPhoneRecorded] = useState(null);
  const [clock, setClock] = useState(Date.now);
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
  // What the card is editing, which is not yet what was applied: the pairs on
  // offer and the days listed have to follow the source and the dogs being
  // picked, or the card answers for the previous query — picking the cloud and
  // two of its dogs would still be told which days the BLE pair has.
  // Kept as a string so re-sending the same draft is not a new state.
  const [draftKey, setDraftKey] = useState('');
  const scope = useMemo(() => {
    const draft = draftKey ? JSON.parse(draftKey) : null;
    return {
      source: draft?.source || preferences.source,
      masters: draft?.masters?.length ? draft.masters : preferences.masters,
      slaves: draft?.slaves?.length ? draft.slaves : preferences.slaves,
    };
  }, [draftKey, preferences]);
  const source = scope.source;
  // A draft only lives until the query it belongs to is applied (or the card is
  // left); otherwise the next visit would list another source's devices.
  useEffect(() => setDraftKey(''), [preferences]);
  useEffect(() => {
    if (!loaded || !active) return undefined;
    let alive = true;
    db.current?.listDevices(source, owner)
      .then(value => { if (alive) setDevices(value); })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, [loaded, active, source, owner]);
  useEffect(() => {
    if (!loaded || !active) return undefined;
    let alive = true;
    db.current?.hasPhoneTrack()
      .then(value => { if (alive) setPhoneRecorded(value); })
      .catch(() => { if (alive) setPhoneRecorded(null); });
    return () => { alive = false; };
  }, [loaded, active]);
  // Which days actually hold rows for the current selection, so the card can
  // offer them instead of making the user query a day to find out it is empty.
  // For the cloud source the account may hold days this phone never downloaded,
  // so those are asked for as well and marked.
  useEffect(() => {
    if (!loaded || !active || !daysWanted) return undefined;
    let alive = true;
    const controller = new AbortController();
    setDaysLoading(true);
    (async () => {
      setDaysIncomplete('');
      let local = [];
      try {
        local = await db.current?.listDays({ ...preferences, ...scope }, owner) || [];
      } catch {
        local = [];
      }
      if (alive) setDays(local);
      if (scope.source !== 'cloud' || !owner) {
        if (alive) setDaysLoading(false);
        return;
      }
      try {
        const { days: cloud, stopped, message } = await listCloudDays({
          client: getCloudClient(),
          masters: scope.masters,
          slaves: scope.slaves,
          signal: controller.signal,
          // Each day the walk finds is shown straight away; the whole walk
          // takes about twenty seconds on a real account.
          onDay: (day, found) => { if (alive) setDays(mergeDays(local, found)); },
        });
        if (!alive) return;
        if (cloud.length) setDays(mergeDays(local, cloud));
        if (stopped === 'error') setDaysIncomplete(message || '雲端沒有回應');
      } catch {
        // Offline or not signed in: the local days are still the honest answer.
      } finally {
        if (alive) setDaysLoading(false);
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [loaded, active, daysWanted, scope, owner, preferences]);
  useEffect(() => {
    if (!loaded || !active) return undefined;
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
  }, [loaded, active, preferences, owner, key]);
  return {
    preferences, loaded, error, busy, key, devices, days, daysLoading, daysIncomplete,
    phoneRecorded,
    /** The card calls this while editing, before anything is applied. */
    preview: value => setDraftKey(value ? JSON.stringify(value) : ''),
    /** The card calls this when it opens the section that lists the days. */
    wantDays: setDaysWanted,
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
