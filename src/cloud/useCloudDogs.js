import { captureMapRead } from './CloudPublication';
import { logger } from '../logger';
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
// loaded: the first read has finished (A6 waits for it, so it never flashes
// before the stored dogs are read).
const empty = () => ({ rows: [], packets: [], track: [], holds: {}, statuses: {}, ranges: {}, error: '', loaded: false });
export function useCloudDogs(database, owner, enabled, now = Date.now, trackSinceMs = null,
  { active = true, revision = 0, cloudBusy = false, cloudSuccess = null, getMapPublication = null } = {}) {
  const [cache, setCache] = useState(() => ({ owner, database, value: empty() }));
  // A failed/aborted download leaves partial rows in SQLite. Keep its cloud
  // side quarantined until a complete pass, while still accepting local BLE.
  const publication = useRef(null);
  if (!publication.current || publication.current.owner !== owner || publication.current.database !== database || publication.current.enabled !== enabled)
    publication.current = { owner, database, enabled, commit: null, busy: false, blocked: false, success: cloudSuccess, releaseSuccess: cloudSuccess, epoch: 0,
      rows: [], packets: [], track: [] };
  const gate = publication.current;
  if (gate.busy !== cloudBusy || gate.success !== cloudSuccess) {
    gate.epoch++;
    if (cloudBusy) gate.blocked = true;
    else if (gate.releaseSuccess !== cloudSuccess) {
      gate.blocked = false;
      gate.releaseSuccess = cloudSuccess;
    }
    gate.busy = cloudBusy;
    gate.success = cloudSuccess;
  }
  const scheduler = useRef(getMapPublication);
  scheduler.current = getMapPublication;
  const refresh = useRef(null);
  const inFlight = useRef(Promise.resolve());
  const lastTrigger = useRef({ revision, cloudBusy, cloudSuccess });
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
        const attempt = publication.current;
        const epoch = attempt.epoch;
        const fence = captureMapRead(scheduler.current, owner, attempt.success);
        const blockCloud = attempt.blocked || !fence.open;
        const acceptsCloud = () => alive && publication.current === attempt
          && attempt.epoch === epoch && !attempt.blocked && fence.valid();
        const readOwner = blockCloud ? null : owner;
        const readRows = readOwner ? await database.latestBySlave(readOwner, LATEST_SINCE) : [];
        if (!alive) return;
        // Signed out, this phone's own BLE packets only (latestStatusRows).
        const packets = database.latestStatusRows
          ? await database.latestStatusRows(readOwner, LATEST_SINCE, now()) : [];
        // The path is only read when something asks for it: it is the larger
        // query, and the card draws no line while the path switch is off.
        const readTrack = readOwner && Number.isFinite(trackSinceMs)
          ? await database.trackBySlave(readOwner, now() - trackSinceMs) : [];
        let holds = {}, statuses = {}, ranges = {};
        if (database.holdRows) {
          // A long pause rebuilds the hold trackers and replays range changes
          // since their checkpoints, including fixes outside the hold window.
          const replaced = holdState.current;
          if (replaced?.owner !== owner || replaced?.database !== database
            || (!blockCloud && now() - replaced.polledAt > HOLD_LOOKBACK_MS)) {
            const store = createHoldStore();
            store.seedRanges(await database.loadRangeState?.(owner) ?? {});
            // Same account and database: the receiver-range judgements stay.
            if (replaced?.owner === owner && replaced?.database === database) store.seedRanges(replaced.store.ranges());
            holdState.current = { owner, database, store, cursors: null, polledAt: now(), replaySince: Math.min(now() - HOLD_LOOKBACK_MS,
              ...Object.values(store.ranges()).map(range => range.lastLocalAt ?? range.lastTime ?? now())) };
          }
          const state = holdState.current;
          try {
            const batch = await database.holdRows(readOwner, state.replaySince ?? now() - HOLD_LOOKBACK_MS, state.cursors);
            if (!alive || holdState.current !== state) return;
            // Stored rows moved in time (cloud time repair): replay them all.
            const accept = acceptsCloud();
            if (batch.reset && accept) {
              const judged = state.store.ranges();
              state.store = createHoldStore();
              state.store.seedRanges(judged);
            }
            state.store.ingest(accept ? batch : {
              rows: batch.rows?.filter(row => row.source !== 'cloud'),
              seeds: batch.seeds?.filter(row => row.source !== 'cloud'),
            });
            state.cursors = accept ? batch.cursors : { ...batch.cursors,
              supabase_dog_status: state.cursors?.supabase_dog_status ?? 0,
              repairs: state.cursors?.repairs ?? batch.cursors?.repairs };
            state.polledAt = now();
          } catch (error) {
            // A failed hold read must not empty the map: keep drawing the last holds.
            logger.warn('[Indoor hold] read failed', error?.message);
            // A new committed download must publish positions and holds together.
            if (acceptsCloud() && attempt.commit !== attempt.success) throw error;
          }
          holds = state.store.holds(now());
          statuses = state.store.statuses();
          // Each dog's receiver-range judgement, fed by the same rows.
          ranges = state.store.ranges();
          await database.saveRangeState?.(owner, ranges);
        }
        if (acceptsCloud()) {
          attempt.rows = readRows;
          attempt.packets = packets.filter(row => row.source === 'cloud');
          attempt.track = readTrack;
          attempt.commit = attempt.success;
        }
        if (alive) setCache({ owner, database, value: {
          rows: attempt.rows, packets: [...packets.filter(row => row.source !== 'cloud'), ...attempt.packets],
          track: attempt.track, holds, statuses, ranges, error: '', loaded: true,
          cloudCommit: attempt.commit,
        } });
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
    const before = lastTrigger.current;
    if (before.revision !== revision || before.cloudBusy !== cloudBusy || before.cloudSuccess !== cloudSuccess)
      refresh.current?.();
    lastTrigger.current = { revision, cloudBusy, cloudSuccess };
  }, [revision, cloudBusy, cloudSuccess]);
  // Never expose another account's cache, even for the render before effects run.
  return enabled && cache.owner === owner && cache.database === database ? cache.value : empty();
}
