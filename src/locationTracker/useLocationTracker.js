import { useEffect, useRef, useState } from 'react';
import { readLocationPage } from './LocationTrackerDatabase';
import { startLocationTracker, stopLocationTracker } from './LocationTrackerService';

export function useLocationTracker(foreground) {
  const [cursors, setCursors] = useState([0]);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ rows: [], total: 0, running: false, status: '讀取中…' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const action = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const before = cursors[cursors.length - 1];
  useEffect(() => {
    if (!foreground) return undefined;
    let alive = true;
    let timer;
    async function load() {
      setLoading(true);
      try {
        const result = await readLocationPage(before);
        if (alive) { setData(result); setError(null); }
      } catch (e) { if (alive) setError(e.message); }
      finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, 10000);
        }
      }
    }
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [before, revision, foreground]);
  async function toggle() {
    if (action.current) return;
    action.current = true;
    setBusy(true);
    setError(null);
    try {
      if (data.running) await stopLocationTracker();
      else await startLocationTracker();
      if (mounted.current) setRevision(value => value + 1);
    } catch (e) { if (mounted.current) setError(e.message); }
    finally {
      action.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    ...data, error, busy, loading, toggle, page: cursors.length,
    refresh: () => { setCursors([0]); setRevision(value => value + 1); },
    next: () => { if (data.hasMore && !loading) setCursors(value => [...value, data.rows[data.rows.length - 1].id]); },
    previous: () => setCursors(value => value.length > 1 ? value.slice(0, -1) : value),
  };
}
