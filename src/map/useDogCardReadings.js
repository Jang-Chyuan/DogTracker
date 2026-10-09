import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_ACTIVITY_LOOKBACK_MS, dogCardReadings } from '../activity/DogCardReadings';

// The open card re-reads its dog's rows this often.
export const CARD_READ_MS = 30000;

/**
 * The open card's activity and battery readings (DogCardReadings), read while
 * the card is open and re-read every CARD_READ_MS.
 * @param read async (slaveId, since) => { local, cloud, battery } rows, or
 *   null when nothing can be read (no database)
 * @param slaveId the open dog, or null
 * @param now the map clock
 * @returns {{ loaded: boolean, activity, battery }}
 */
export function useDogCardReadings(read, slaveId, now) {
  const [state, setState] = useState({ read: null, slaveId: null, rows: null });
  // Read back from the map clock (a screen fixture's clock is fixed).
  const clock = useRef(now);
  clock.current = now;
  useEffect(() => {
    if (!read || slaveId == null) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const rows = await read(slaveId, clock.current - CARD_ACTIVITY_LOOKBACK_MS);
        if (alive) setState({ read, slaveId, rows });
      } catch (error) {
        // The rows say 「—」 rather than another dog's or an error text.
        console.warn('[Dog card] read failed', error?.message);
        if (alive) setState(current => (current.slaveId === slaveId && current.read === read ? current
          : { read, slaveId, rows: null }));
      } finally {
        if (alive) timer = setTimeout(poll, CARD_READ_MS);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [read, slaveId]);
  // Another dog's, account's or fixture's rows are never shown for this one.
  const rows = state.slaveId === slaveId && state.read === read ? state.rows : null;
  // The minute buckets follow the clock (the running minute joins once it
  // ends), not only new reads.
  const minute = Math.floor(now / 60000);
  return useMemo(() => (rows
    ? { loaded: true, ...dogCardReadings(rows, minute * 60000 + 59999) }
    : { loaded: false, activity: null, battery: null }), [rows, minute]);
}
