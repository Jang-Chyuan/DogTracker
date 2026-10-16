import { logger } from '../logger';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  CARD_ACTIVITY_LOOKBACK_MS,
  CARD_REST_MAX_LOOKBACK_MS,
  CARD_REST_STEP_MS,
  dogCardReadings,
} from '../activity/DogCardReadings';
import { activityState, minuteOf } from '../activity/ActivityMinutes';

// The open card re-reads its dog's rows this often.
export const CARD_READ_MS = 30000;

/**
 * Does the rest the readings end in run back to where they begin (so it may
 * have begun earlier)? Judged at the newest finished minute, as the card is.
 */
export function restReachesEdge(activity) {
  const minutes = activity?.minutes || [];
  if (!minutes.length || !Number.isFinite(activity.from)) return false;
  const newest = Number.isFinite(activity.newestAt) ? activity.newestAt : minutes[minutes.length - 1].minute;
  return !!activityState(minutes, { end: minuteOf(newest), from: activity.from }).over;
}

// The older activity rows read for one dog, oldest first: from `from` up to
// `until`, where the card's own rows begin.
const joined = (earlier, rows) => (earlier ? {
  ...rows,
  local: [...earlier.local, ...(rows.local || [])],
  cloud: [...earlier.cloud, ...(rows.cloud || [])],
  since: earlier.from,
} : rows);

/**
 * What the open card ends up showing for one dog, read in one go (the hook
 * below gets there a read at a time): its rows, then older activity rows a
 * CARD_REST_STEP_MS at a time while the rest reaches their edge, down to
 * CARD_REST_MAX_LOOKBACK_MS. For screen fixtures and tests.
 */
export async function readCardReadings(read, slaveId, now) {
  const rows = await read(slaveId, now - CARD_ACTIVITY_LOOKBACK_MS);
  let earlier = null;
  let readings = dogCardReadings(rows, now);
  while (restReachesEdge(readings.activity) && readings.activity.from > now - CARD_REST_MAX_LOOKBACK_MS) {
    const from = readings.activity.from;
    const start = Math.max(now - CARD_REST_MAX_LOOKBACK_MS, from - CARD_REST_STEP_MS);
    const chunk = await read(slaveId, start, from);
    if (!chunk) break;
    earlier = { from: start, local: [...chunk.local, ...(earlier?.local || [])],
      cloud: [...chunk.cloud, ...(earlier?.cloud || [])] };
    readings = dogCardReadings(joined(earlier, rows), now);
  }
  return readings;
}

/**
 * The open card's activity and battery readings (DogCardReadings), read while
 * the card is open and re-read every CARD_READ_MS.
 *
 * A rest that reaches back to where the CARD_ACTIVITY_LOOKBACK_MS rows begin
 * is followed further back (2026-10-16: the row said 「超過 6 小時」 for a dog
 * that had rested 8 hours): one CARD_REST_STEP_MS of older activity rows at a
 * time, read only then, until the rest's start is among them or
 * CARD_REST_MAX_LOOKBACK_MS is reached. The older rows are kept per dog for as
 * long as the card is open (switching back reads nothing again); each re-read
 * also reads the few seconds between them and the newest rows' start, so no
 * gap opens as the window moves on. Until the start is known the readings say
 * `extending` (the row shows 「休息中」 without a duration rather than a
 * number that is about to change).
 * @param read async (slaveId, since, until?) => { local, cloud, battery }
 *   rows (with `until`: older activity rows only, or null when they cannot be
 *   read now), or null when nothing can be read (no database)
 * @param slaveId the open dog, or null
 * @param now the map clock
 * @returns {{ loaded: boolean, activity, battery }}
 */
export function useDogCardReadings(read, slaveId, now, revision = 0) {
  const [state, setState] = useState({ read: null, slaveId: null, rows: null });
  // The rows last read for each dog this card showed (this reader only):
  // swiping back to a dog shows them at once, in the same render as its
  // name, while they are read again (2026-10-16: every switch drew the card
  // twice, the second time when the rows came).
  const seen = useRef({ read: null, rows: new Map() });
  if (seen.current.read !== read) seen.current = { read, rows: new Map() };
  // Each dog's older rows: { from, until, local, cloud, held } (this reader's).
  const older = useRef({ read: null, dogs: new Map() });
  if (older.current.read !== read) older.current = { read, dogs: new Map() };
  const [olderRevision, setOlderRevision] = useState(0);
  // Read back from the map clock (a screen fixture's clock is fixed).
  const clock = useRef(now);
  clock.current = now;
  useEffect(() => {
    if (!read || slaveId == null) return undefined;
    let alive = true, timer;
    const dogs = older.current.dogs;
    async function poll() {
      try {
        const since = clock.current - CARD_ACTIVITY_LOOKBACK_MS;
        const rows = await read(slaveId, since);
        // The older rows reach up to where these begin: the moments the
        // window moved on since they were read are read too.
        const earlier = dogs.get(slaveId);
        const begins = Number.isFinite(rows?.since) ? rows.since : since;
        if (earlier && earlier.until < begins) {
          const gap = await read(slaveId, earlier.until, begins);
          if (gap) dogs.set(slaveId, { ...earlier, until: begins,
            local: [...earlier.local, ...gap.local], cloud: [...earlier.cloud, ...gap.cloud] });
          else dogs.delete(slaveId);
        }
        // An older read held back by a download is asked again now.
        const held = dogs.get(slaveId);
        if (held?.held) dogs.set(slaveId, { ...held, held: false });
        if (alive) {
          seen.current.rows.set(slaveId, rows);
          // Not urgent: a swipe on to another dog goes first.
          startTransition(() => setState({ read, slaveId, rows }));
        }
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
  const rows = state.slaveId === slaveId && state.read === read ? state.rows
    : read && slaveId != null ? seen.current.rows.get(slaveId) ?? null : null;
  const earlier = rows ? older.current.dogs.get(slaveId) ?? null : null;
  // The older rows join only where they meet these (see the gap read above).
  const usable = earlier && earlier.until >= (rows?.since ?? Infinity) ? earlier : null;
  // The minute buckets follow the clock (the running minute joins once it
  // ends), not only new reads.
  const minute = Math.floor(now / 60000);
  // Worked out once per read, older rows and minute (a dog swiped back to
  // reuses it).
  const worked = useRef(new WeakMap());
  const readings = useMemo(() => {
    if (!rows) return { loaded: false, activity: null, battery: null };
    const known = worked.current.get(rows);
    if (known?.minute === minute && known.usable === usable) return known.value;
    const value = { loaded: true, ...dogCardReadings(joined(usable, rows), minute * 60000 + 59999) };
    worked.current.set(rows, { minute, usable, value });
    return value;
  // olderRevision: the older rows just read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, usable, minute, olderRevision]);
  // Follow the rest further back, a step at a time, while it reaches the
  // edge of what was read (and not past the limit).
  const reaches = readings.loaded && restReachesEdge(readings.activity);
  const from = readings.activity?.from ?? null;
  const limit = now - CARD_REST_MAX_LOOKBACK_MS;
  const more = reaches && Number.isFinite(from) && from > limit && !usable?.held;
  const asking = useRef(null);
  useEffect(() => {
    if (!more || !read || slaveId == null) return undefined;
    const key = `${slaveId}:${from}`;
    if (asking.current === key) return undefined;
    asking.current = key;
    let alive = true;
    const dogs = older.current.dogs;
    const start = Math.max(limit, from - CARD_REST_STEP_MS);
    (async () => {
      let next;
      try {
        const chunk = await read(slaveId, start, from);
        const current = dogs.get(slaveId);
        next = chunk ? { from: start, until: current?.until ?? rows.since ?? from,
          local: [...chunk.local, ...(current?.local || [])], cloud: [...chunk.cloud, ...(current?.cloud || [])],
          held: false }
          // A download is publishing: say 「超過」 for now, ask again with the next read.
          : { ...(current || { from, until: rows.since ?? from, local: [], cloud: [] }), held: true };
      } catch (error) {
        logger.warn('[Dog card] older activity read failed', error?.message);
        const current = dogs.get(slaveId);
        next = { ...(current || { from, until: rows.since ?? from, local: [], cloud: [] }), held: true };
      }
      dogs.set(slaveId, next);
      if (alive) setOlderRevision(value => value + 1);
      if (asking.current === key) asking.current = null;
    })();
    return () => { alive = false; };
    // rows: only for where the first older read meets them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more, read, slaveId, from]);
  if (!readings.loaded) return readings;
  return more ? { ...readings, activity: { ...readings.activity, extending: true } } : readings;
}
