import { useEffect, useState } from 'react';

export const RECENT_ROWS = 100;
const POLL_MS = 5000;

/**
 * This phone's newest receiver rows (dog_status) while 診斷 (S8) is open, for
 * the speed buffer line. `listHistory(limit)` reads them (the hardware
 * diagnostics adapter, or a fixture's rows). A failed read keeps the last.
 */
export function useRecentRows(listHistory, active) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!active || !listHistory) return undefined;
    let alive = true, timer;
    const load = async () => {
      try {
        const next = await listHistory(RECENT_ROWS);
        if (alive) setRows(next || []);
      } catch {
        // The page shows the rest; 即時資料 says why it cannot read.
      }
      if (alive) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [listHistory, active]);
  return rows;
}
