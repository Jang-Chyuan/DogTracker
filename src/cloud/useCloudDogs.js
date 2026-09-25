import { useEffect, useRef, useState } from 'react';
import { MAX_AGE_MS } from '../map/DogMerge';

export const POLL_MS = 10000;

/**
 * Reads the newest downloaded row per dog from the local cloud copy. The map
 * never queries Supabase: CloudSync owns downloading, this only reads what is
 * already on the phone, so the map keeps working offline.
 *
 * Demo mode must not see real positions, so the caller passes enabled=false.
 */
const empty = () => ({ rows: [], packets: [], track: [], error: '' });
export function useCloudDogs(database, owner, enabled, now = Date.now, trackSinceMs = null,
  { active = true, revision = 0 } = {}) {
  const [cache, setCache] = useState(() => ({ owner, database, value: empty() }));
  const refresh = useRef(null);
  const inFlight = useRef(Promise.resolve());
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (!database || !owner || !enabled) {
      setCache({ owner, database, value: empty() });
      return undefined;
    }
    setCache(current => current.owner === owner && current.database === database
      ? current : { owner, database, value: empty() });
    if (!active) return undefined;
    let alive = true;
    let timer;
    let running = false, pending = false;
    async function poll() {
      if (!alive) return;
      if (running) { pending = true; return; }
      clearTimeout(timer);
      running = true;
      const previous = inFlight.current;
      let finish;
      inFlight.current = new Promise(resolve => { finish = resolve; });
      try {
        await previous;
        if (!alive) return;
        const rows = await database.latestBySlave(owner, now() - MAX_AGE_MS);
        if (!alive) return;
        const packets = database.latestStatusRows
          ? await database.latestStatusRows(owner, now() - MAX_AGE_MS) : [];
        // The path is only read when something asks for it: it is the larger
        // query, and the card draws no line while the path switch is off.
        const track = Number.isFinite(trackSinceMs)
          ? await database.trackBySlave(owner, now() - trackSinceMs) : [];
        if (alive) setCache({ owner, database, value: { rows, packets, track, error: '' } });
      } catch (error) {
        // Keep the last rows: a failed read must not empty the map.
        if (alive) setCache(current => ({ owner, database,
          value: { ...(current.owner === owner && current.database === database ? current.value : empty()), error: error.message } }));
      } finally {
        running = false;
        finish();
        if (alive) {
          timer = setTimeout(poll, pending ? 0 : POLL_MS);
          pending = false;
        }
      }
    }
    refresh.current = poll;
    poll();
    return () => { alive = false; clearTimeout(timer); refresh.current = null; };
  }, [database, owner, enabled, active, now, trackSinceMs]);
  useEffect(() => {
    if (lastRevision.current !== revision) refresh.current?.();
    lastRevision.current = revision;
  }, [revision]);
  // Never expose another account's cache, even for the render before effects run.
  return enabled && owner && cache.owner === owner && cache.database === database ? cache.value : empty();
}
