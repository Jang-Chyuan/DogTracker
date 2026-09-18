import { useEffect, useState } from 'react';
import { MAX_AGE_MS } from '../map/DogMerge';

export const POLL_MS = 10000;

/**
 * Reads the newest downloaded row per dog from the local cloud copy. The map
 * never queries Supabase: CloudSync owns downloading, this only reads what is
 * already on the phone, so the map keeps working offline.
 *
 * Demo mode must not see real positions, so the caller passes enabled=false.
 */
export function useCloudDogs(database, owner, enabled, now = Date.now) {
  const [state, setState] = useState({ rows: [], error: '' });
  useEffect(() => {
    if (!database || !owner || !enabled) {
      setState(current => (current.rows.length || current.error
        ? { rows: [], error: '' } : current));
      return undefined;
    }
    let alive = true;
    let timer;
    async function poll() {
      try {
        const rows = await database.latestBySlave(owner, now() - MAX_AGE_MS);
        if (alive) setState({ rows, error: '' });
      } catch (error) {
        // Keep the last rows: a failed read must not empty the map.
        if (alive) setState(current => ({ ...current, error: error.message }));
      } finally {
        if (alive) timer = setTimeout(poll, POLL_MS);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [database, owner, enabled, now]);
  return state;
}
