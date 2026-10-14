import { captureMapRead } from './CloudPublication';
import { logger } from '../logger';
import { useEffect, useRef, useState } from 'react';
import { createHoldStore, HOLD_LOOKBACK_MS } from '../placement/HoldStore';
import { distanceMeters, fixQuality, HOLD_CONFIG } from '../placement/IndoorHold';
import { cloudRowOnPhoneClock, serverClock } from './ServerClock';

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
const empty = () => ({ rows: [], packets: [], track: [], holds: {}, statuses: {}, ranges: {}, batteries: {}, error: '', loaded: false });
// Pair content includes every exposed field (time repairs, master, quality and
// status), not just IDs. These strings stay in memory and are never logged.
function latestPairs(snapshot) {
  const fixes = new Map((snapshot?.rows ?? []).map(row => [row.slave_id, row]));
  return Object.fromEntries((snapshot?.packets ?? []).map(packet => [packet.slave_id,
    JSON.stringify([packet, fixes.get(packet.slave_id) ?? null])]));
}
function retainedContext(values, before, after, continued = new Set()) {
  // IDs absent from both cloud sets belong to the independently read BLE
  // context. New/changed cloud dogs cannot inherit another pair's anchor,
  // except a held dog that only reported again (continuedHolds).
  return Object.fromEntries(Object.entries(values ?? {}).filter(([id]) =>
    before != null && (before[id] === after[id] || continued.has(id))));
}
const newer = (next, old) => !!next && !!old && next.event_id !== old.event_id
  && next.track_at > old.track_at && next.master_id === old.master_id;
const point = row => ({ latitude: row.slave_lat, longitude: row.slave_lon, satellites: row.satellites, hdop: row.hdop });
// A dog held indoors keeps sending packets, so on every resume (and every
// latest poll) its newest packet is new while the half-hour context that
// places its anchor is read seconds later. Until then the house stays: the
// tracker never lets go on one more weak or no-fix packet either. A newer
// packet from the same Master whose fix is unchanged, or a weak/close new fix,
// continues the hold. A sharp fix beyond the release radius is shown at once
// (real movement); a repaired or other-Master pair never borrows the anchor.
// The context reread then replaces this with the tracker's own judgement.
function continuedHolds(holds, before, after) {
  const continued = new Set();
  if (before == null) return continued;
  for (const [id, hold] of Object.entries(holds ?? {})) {
    if (before[id] == null || after[id] == null || before[id] === after[id] || !hold?.coordinate) continue;
    const [oldPacket, oldFix] = JSON.parse(before[id]), [packet, fix] = JSON.parse(after[id]);
    if (!newer(packet, oldPacket)) continue;
    if (JSON.stringify(fix) !== JSON.stringify(oldFix)) {
      if (!fix || !(oldFix ? newer(fix, oldFix) : fix.master_id === packet.master_id)) continue;
      const leaving = fixQuality(point(fix)) === 'good'
        && distanceMeters(hold.coordinate, point(fix)) > HOLD_CONFIG.releaseRadiusM;
      if (leaving) continue;
    }
    continued.add(id);
  }
  return continued;
}
export function useCloudDogs(database, owner, enabled, now = Date.now, trackSinceMs = null,
  { active = true, contextEnabled = enabled, latestFirst = false, revision = 0, cloudBusy = false, cloudSuccess = null, getMapPublication = null } = {}) {
  const [cache, setCache] = useState(() => ({ owner, database, value: empty() }));
  // A failed/aborted download leaves partial rows in SQLite. Keep its cloud
  // side quarantined until a complete pass, while still accepting local BLE.
  const publication = useRef(null);
  if (!publication.current || publication.current.owner !== owner || publication.current.database !== database || publication.current.enabled !== enabled || publication.current.latestFirst !== latestFirst)
    publication.current = { owner, database, enabled, latestFirst, commit: null, busy: false, blocked: false, success: cloudSuccess, releaseSuccess: cloudSuccess, epoch: 0,
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
  // Latest positions have their own short reader. Optional hold/context reads
  // may still be running when a new download completes; they must not queue
  // the map's exact-attempt acceptance behind that earlier computation.
  useEffect(() => {
    if (!latestFirst || !database || !enabled || !owner || !active || cloudBusy || !(cloudSuccess > 0)) return undefined;
    let alive = true;
    const attempt = publication.current;
    const epoch = attempt.epoch;
    let fence;
    try { fence = captureMapRead(scheduler.current, owner, cloudSuccess); } catch { return undefined; }
    const valid = () => {
      try { return alive && publication.current === attempt && attempt.epoch === epoch
        && !attempt.blocked && fence.open && fence.valid(); } catch { return false; }
    };
    async function readLatestPositions() {
      try {
        if (!valid()) return;
        const producer = scheduler.current?.();
        const readback = producer?.readback;
        const supplied = readback?.owner === owner && readback.scope === producer.scope
          && readback.generation === producer.generation && readback.attempt === producer.attempt
          && readback.revision === cloudSuccess ? readback : null;
        const snapshot = supplied?.snapshot ?? await database.readLatestSnapshot(owner, { positionsOnly: true });
        if (!snapshot?.verified || !valid()) return;
        const accepted = scheduler.current?.();
        attempt.rows = snapshot.rows;
        attempt.packets = snapshot.packets;
        attempt.commit = cloudSuccess;
        attempt.cloudPublication = accepted ? { owner: accepted.owner, scope: accepted.scope,
          generation: accepted.generation, attempt: accepted.attempt, revision: cloudSuccess } : null;
        attempt.baselineLoaded = true;
        setCache(current => {
          if (!valid()) return current;
          const prior = current.owner === owner && current.database === database ? current.value : empty();
          // Identical accepted packet+fix content keeps its known indoor
          // anchor even when a refresh increments SQLite revision. Repaired,
          // other-Master or clearly departing content must not borrow that
          // anchor before context is read; a held dog that only reported
          // again keeps it (continuedHolds), so resume never jumps it.
          const pairs = latestPairs(snapshot);
          const continued = continuedHolds(prior.holds, prior.contextPairs, pairs);
          return { owner, database, value: { ...prior, rows: snapshot.rows,
            packets: [...prior.packets.filter(row => row.source !== 'cloud'), ...snapshot.packets],
            holds: retainedContext(prior.holds, prior.contextPairs, pairs, continued),
            statuses: retainedContext(prior.statuses, prior.contextPairs, pairs, continued),
            ranges: retainedContext(prior.ranges, prior.contextPairs, pairs, continued), error: '', loaded: true,
            cloudCommit: cloudSuccess, cloudPublication: attempt.cloudPublication,
            cachedBaseline: false, acceptedReadback: supplied } };
        });
      } catch (error) {
        if (valid()) setCache(current => valid() ? ({ owner, database,
          value: { ...(current.owner === owner && current.database === database ? current.value : empty()), error: error.message } }) : current);
      }
    }
    readLatestPositions();
    return () => { alive = false; };
  }, [database, owner, enabled, active, latestFirst, revision, cloudBusy, cloudSuccess]);
  useEffect(() => {
    if (!database || !enabled) {
      // No database or logged out: the next start replays from scratch.
      holdState.current = null;
      setCache({ owner, database, value: empty() });
      return undefined;
    }
    setCache(current => current.owner === owner && current.database === database
      ? current : { owner, database, value: empty() });
    // Local/archive context cannot run before local migrations. Keep the
    // independently accepted latest cache and its ACK while that owner waits.
    if (!contextEnabled) { holdState.current = null; return undefined; }
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
        const cachedFence = scheduler.current?.();
        const readOwner = latestFirst ? owner : blockCloud ? null : owner;
        const snapshot = latestFirst && readOwner ? await database.readLatestSnapshot(readOwner, {
          bootstrap: cachedFence?.bootstrapAllowed ?? true,
          isCurrent: () => {
            const current = scheduler.current?.();
            return alive && publication.current === attempt && (!cachedFence ||
              cachedFence.owner === current?.owner && cachedFence.scope === current.scope
              && cachedFence.generation === current.generation && cachedFence.attempt === current.attempt);
          },
        }) : null;
        const acceptsBaseline = () => {
          const current = scheduler.current?.();
          return latestFirst && snapshot && !attempt.baselineLoaded && alive && publication.current === attempt
            && cachedFence?.owner === owner && current?.owner === owner && cachedFence.scope === current.scope
            && cachedFence.generation === current.generation && cachedFence.attempt === current.attempt
            && current.mapSuccessRevision === 0 && Number.isFinite(current.snapshotBaseRevision)
            && snapshot.revision <= current.snapshotBaseRevision;
        };
        const readRows = latestFirst ? snapshot?.rows ?? []
          : readOwner ? await database.latestBySlave(readOwner, LATEST_SINCE) : [];
        if (!alive) return;
        // Signed out, this phone's own BLE packets only (latestStatusRows).
        const packets = database.latestStatusRows
          ? [...await database.latestStatusRows(latestFirst ? null : readOwner, LATEST_SINCE, now()), ...(snapshot?.packets ?? [])] : snapshot?.packets ?? [];
        // The path is only read when something asks for it: it is the larger
        // query, and the card draws no line while the path switch is off.
        const readTrack = !latestFirst && readOwner && Number.isFinite(trackSinceMs)
          ? await database.trackBySlave(readOwner, now() - trackSinceMs) : [];
        let holds = {}, statuses = {}, ranges = {}, batteries = {};
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
            const batch = await database.holdRows(latestFirst ? null : readOwner, state.replaySince ?? now() - HOLD_LOOKBACK_MS, state.cursors);
            if (!alive || holdState.current !== state) return;
            // Stored rows moved in time (cloud time repair): replay them all.
            const accept = acceptsCloud() || acceptsBaseline();
            if (batch.reset && accept && !latestFirst) {
              const judged = state.store.ranges();
              state.store = createHoldStore();
              state.store.seedRanges(judged);
            }
            if (latestFirst && accept && snapshot && state.snapshotRevision !== snapshot.revision) {
              // Only independently downloaded snapshot context feeds live
              // holds. Historical backfill and metadata repairs stay outside.
              const context = snapshot.context || [];
              // On this phone's clock, as the BLE rows they meet (ServerClock):
              // a server or teammate clock ahead would otherwise make the
              // range ignore this phone's own newer packets.
              const offset = serverClock.offset();
              const normalize = row => ({ ...row, source: 'cloud', time: cloudRowOnPhoneClock(row, offset).track_at,
                latitude: row.slave_lat, longitude: row.slave_lon });
              const live = new Map([...context, ...(snapshot.packets || [])].map(row => [row.event_id, row]));
              state.store.ingest({ rows: [...live.values()].map(normalize), seeds: (snapshot.seeds || []).map(normalize) });
              state.snapshotRevision = snapshot.revision;
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
            // The independent latest reader publishes positions first; a hold
            // failure still rejects the legacy combined publication.
            if (acceptsCloud() && attempt.commit !== attempt.success) throw error;
          }
          holds = state.store.holds(now());
          statuses = state.store.statuses();
          // Each dog's receiver-range judgement, fed by the same rows.
          ranges = state.store.ranges();
          // Each dog's battery judged over the same rows (BatteryPlausibility).
          batteries = state.store.batteries();
          await database.saveRangeState?.(owner, ranges);
        }
        const baseline = !acceptsCloud() && acceptsBaseline();
        if (acceptsCloud() || baseline) {
          attempt.rows = readRows;
          attempt.packets = packets.filter(row => row.source === 'cloud');
          attempt.track = readTrack;
          if (!baseline) {
            attempt.commit = attempt.success;
            const accepted = scheduler.current?.();
            attempt.cloudPublication = accepted ? { owner: accepted.owner, scope: accepted.scope,
              generation: accepted.generation, attempt: accepted.attempt, revision: attempt.success } : null;
          }
          attempt.baselineLoaded = true;
        }
        // A slow old context read cannot attach its holds to positions already
        // accepted by the independent latest reader for a newer publication.
        if (alive && (!latestFirst || acceptsCloud() || baseline || attempt.commit == null)) setCache({ owner, database, value: {
          rows: attempt.rows, packets: [...packets.filter(row => row.source !== 'cloud'), ...attempt.packets],
          track: attempt.track, holds, statuses, ranges, batteries, error: '', loaded: true,
          cloudCommit: attempt.commit, ...(latestFirst ? { cachedBaseline: baseline, cloudPublication: attempt.cloudPublication ?? null,
            contextPairs: acceptsCloud() || baseline ? latestPairs(snapshot) : null } : {}),
        } });
      } catch (error) {
        // Keep the last rows: a failed read must not empty the map.
        if (alive) setCache(current => {
          // Optional context failure cannot revoke an accepted latest position
          // proof or overwrite a newer reader's own error. Baseline/legacy
          // reads still expose their original failure and retry contract.
          if (latestFirst && publication.current.commit != null) return current;
          return { owner, database,
            value: { ...(current.owner === owner && current.database === database ? current.value : empty()), error: error.message } };
        });
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
  }, [database, owner, enabled, contextEnabled, active, now, trackSinceMs, latestFirst]);
  useEffect(() => {
    const before = lastTrigger.current;
    if (before.revision !== revision || before.cloudBusy !== cloudBusy || before.cloudSuccess !== cloudSuccess)
      refresh.current?.();
    lastTrigger.current = { revision, cloudBusy, cloudSuccess };
  }, [revision, cloudBusy, cloudSuccess]);
  // Acknowledge only the cache that React actually committed, never from a
  // state updater or render. The producer validates the immutable object and
  // its complete owner/generation/attempt tuple again before archive work.
  useEffect(() => {
    if (!active || !enabled || cache.owner !== owner || cache.database !== database) return;
    const value = cache.value, readback = value.acceptedReadback;
    if (!readback || value.error || !value.loaded || value.cloudCommit !== readback.revision) return;
    const proof = value.cloudPublication;
    if (proof?.owner !== readback.owner || proof.scope !== readback.scope
      || proof.generation !== readback.generation || proof.attempt !== readback.attempt || proof.revision !== readback.revision) return;
    const current = scheduler.current?.();
    if (current?.readback === readback && current.owner === owner && !current.pending && !current.busy)
      current.acknowledgeMapRead?.(readback);
  }, [cache, owner, database, active, enabled]);
  // Never expose another account's cache, even for the render before effects run.
  return enabled && cache.owner === owner && cache.database === database ? cache.value : empty();
}
