import { useEffect, useState } from 'react';
import { getCloudClient } from './CloudClient';
export const EMPTY_FIXED_LOCATIONS = Object.freeze([]);
export function useFixedLocations(owner, active) {
  const [cache, setCache] = useState({ owner: null, rows: EMPTY_FIXED_LOCATIONS });
  useEffect(() => {
    if (!owner || !active) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const { data, error } = await getCloudClient().from('slave_fixed_locations').select('*');
        if (error) throw error;
        if (alive) setCache(current => {
          const rows = data || EMPTY_FIXED_LOCATIONS;
          return current.owner === owner && JSON.stringify(current.rows) === JSON.stringify(rows)
            ? current : { owner, rows };
        });
      } catch {
        // Keep this account's last successful snapshot while offline.
      } finally { if (alive) timer = setTimeout(poll, 10000); }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [owner, active]);
  return owner && cache.owner === owner ? cache.rows : EMPTY_FIXED_LOCATIONS;
}
