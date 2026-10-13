import { logger } from '../logger';
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
export function useDogCardReadings(read, slaveId, now, revision = 0) {
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
        logger.warn('[Dog card] read failed', error?.message);
        if (alive) setState(current => (current.slaveId === slaveId && current.read === read ? current
          : { read, slaveId, rows: null }));
      } finally {
        if (alive) timer = setTimeout(poll, CARD_READ_MS);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [read, slaveId, revision]);
  // Another dog's, account's or fixture's rows are never shown for this one.
  const rows = state.slaveId === slaveId && state.read === read ? state.rows : null;
  // The minute buckets follow the clock (the running minute joins once it
  // ends), not only new reads.
  const minute = Math.floor(now / 60000);
  return useMemo(() => (rows
    ? { loaded: true, ...dogCardReadings(rows, minute * 60000 + 59999) }
    : { loaded: false, activity: null, battery: null }), [rows, minute]);
}

/** No readings yet (the rows say 「—」). */
export const NO_READINGS = Object.freeze({ loaded: false, activity: null, battery: null });

/**
 * useDogCardReadings for the open card and the dogs drawn beside it (the
 * card's ‹ › neighbours): each dog read and re-read on its own, and a dog's
 * rows kept while it stays in `ids`, so the card that slides in keeps the
 * readings it was drawn with.
 * @returns { [slaveId]: { loaded, activity, battery } }
 */
export function useDogCardReadingsFor(read, ids = [], now, revision = 0) {
  const key = ids.join(',');
  const [state, setState] = useState({ read: null, rows: {} });
  const clock = useRef(now);
  clock.current = now;
  useEffect(() => {
    const wanted = key ? key.split(',').map(Number) : [];
    if (!read || !wanted.length) return undefined;
    let alive = true;
    const timers = [];
    // Only the dogs still wanted, and only this reader's rows.
    setState(current => ({
      read,
      rows: current.read === read
        ? Object.fromEntries(wanted.filter(id => id in current.rows).map(id => [id, current.rows[id]]))
        : {},
    }));
    const store = (id, rows) => setState(current => ({
      read,
      rows: { ...(current.read === read ? current.rows : {}), [id]: rows },
    }));
    wanted.forEach((id, index) => {
      async function poll() {
        try {
          const rows = await read(id, clock.current - CARD_ACTIVITY_LOOKBACK_MS);
          if (alive) store(id, rows);
        } catch (error) {
          // The rows say 「—」 rather than another dog's or an error text.
          logger.warn('[Dog card] read failed', error?.message);
          if (alive) setState(current => (current.read === read && id in current.rows ? current
            : { read, rows: { ...(current.read === read ? current.rows : {}), [id]: null } }));
        } finally {
          if (alive) timers[index] = setTimeout(poll, CARD_READ_MS);
        }
      }
      poll();
    });
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [read, key, revision]);
  const minute = Math.floor(now / 60000);
  const rows = state.read === read ? state.rows : null;
  return useMemo(() => Object.fromEntries((key ? key.split(',').map(Number) : []).map(id => [id,
    rows?.[id] ? { loaded: true, ...dogCardReadings(rows[id], minute * 60000 + 59999) } : NO_READINGS])),
  [rows, minute, key]);
}
