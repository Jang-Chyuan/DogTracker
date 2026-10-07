import { useEffect, useRef, useState } from 'react';
import { createHoldStore, HOLD_LOOKBACK_MS } from '../placement/HoldStore';

export const POLL_MS = 10000;
// The latest rows are read from the start of what this phone stores.
export const LATEST_SINCE = 0;

/**
 * Reads the newest downloaded row per dog from the local cloud copy. The map
 * never queries Supabase: CloudSync owns downloading, this only reads what is
 * already on the phone, so the map keeps working offline.
 */
const empty = () => ({ rows: [], packets: [], track: [], holds: {}, statuses: {}, ranges: {}, error: '' });
export function useCloudDogs(database, owner, enabled, now = Date.now, trackSinceMs = null,
  { active = true, revision = 0 } = {}) {
  const [cache, setCache] = useState(() => ({ owner, database, value: empty() }));
  const refresh = useRef(null);
  const inFlight = useRef(Promise.resolve());
  const lastRevision = useRef(revision);
  // Indoor holds follow every row, so their trackers live across polls; a new
  // account or database starts them over.
  const holdState = useRef(null);
  useEffect(() => {
    if (!database || !enabled) {
      // No database or logged out: the next start replays from scratch.
      holdState.current = null;
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
        // Logged out, only the indoor holds of this phone's own BLE rows apply.
        // Every dog's newest row however old: a dog last seen more than 24
        // hours ago stays on the map, grey (v3 §6). The cloud side is one
        // indexed lookup per dog; the BLE table is capped at 10,000 rows per
        // dog, and a busy day already filled the old 24-hour window.
        const rows = owner ? await database.latestBySlave(owner, LATEST_SINCE) : [];
        if (!alive) return;
        // Signed out, this phone's own BLE packets only (latestStatusRows).
        const packets = database.latestStatusRows
          ? await database.latestStatusRows(owner, LATEST_SINCE, now()) : [];
        // The path is only read when something asks for it: it is the larger
        // query, and the card draws no line while the path switch is off.
        const track = owner && Number.isFinite(trackSinceMs)
          ? await database.trackBySlave(owner, now() - trackSinceMs) : [];
        let holds = {}, statuses = {}, ranges = {};
        if (database.holdRows) {
          // A long pause (background) replays from scratch instead of catching
          // up on every row since.
          const replaced = holdState.current;
          if (replaced?.owner !== owner || replaced?.database !== database
            || now() - replaced.polledAt > HOLD_LOOKBACK_MS) {
            const store = createHoldStore();
            // Same account and database: the receiver-range judgements stay.
            if (replaced?.owner === owner && replaced?.database === database) store.seedRanges(replaced.store.ranges());
            holdState.current = { owner, database, store, cursors: null, polledAt: now() };
          }
          const state = holdState.current;
          try {
            const batch = await database.holdRows(owner, now() - HOLD_LOOKBACK_MS, state.cursors);
            if (!alive || holdState.current !== state) return;
            // Stored rows moved in time (cloud time repair): replay them all.
            if (batch.reset) {
              const judged = state.store.ranges();
              state.store = createHoldStore();
              state.store.seedRanges(judged);
            }
            state.store.ingest(batch);
            state.cursors = batch.cursors;
            state.polledAt = now();
          } catch (error) {
            // A failed hold read must not empty the map: keep drawing the last holds.
            console.warn('[Indoor hold] read failed', error?.message);
          }
          holds = state.store.holds(now());
          statuses = state.store.statuses();
          // Each dog's receiver-range judgement, fed by the same rows.
          ranges = state.store.ranges();
        }
        if (alive) setCache({ owner, database, value: { rows, packets, track, holds, statuses, ranges, error: '' } });
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
  return enabled && cache.owner === owner && cache.database === database ? cache.value : empty();
}
