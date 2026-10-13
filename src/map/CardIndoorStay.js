import { useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../logger';
import { historySourceStream, filterHistoryPoints } from '../history/HistorySources';
import { historyIndoorNodes } from '../history/HistoryStops';
import { configFor } from '../history/HistoryConfig';
import { applyHistoryHolds } from '../placement/IndoorHold';
import { HISTORY_DAY_CONTEXT_MS } from '../mapHistory/HistoryDatabase';

// The live map's hold rows begin half an hour back on a cold start
// (HoldStore.HOLD_LOOKBACK_MS): a dog indoors since last night is held, but its
// first held row is only where those rows begin (HoldStore `fromClipped`). The
// open card then asks the history's own rows how long the stay has been going
// on, at most this far back; a stay older than that reads 「室內・超過 24 時」.
export const CARD_INDOOR_LOOKBACK_MS = 24 * 3600000;

// A start not found yet is asked again after a new download, at most this often
// (the read covers a day of rows).
export const CARD_INDOOR_RETRY_MS = 5 * 60000;

const DOG = configFor('dog');
const PENDING = Object.freeze({ state: 'pending' });

/**
 * Where the history's 室內 stay that holds the dog at `at` begins, read from
 * the history's rows (HistoryDatabase.historyDayRows: `rows`, `seed`) through
 * the history's own steps (historySourceStream → applyHistoryHolds →
 * filterHistoryPoints → historyIndoorNodes), without cutting it at midnight.
 * @param at the live hold's first row (DogMerge `heldFrom`)
 * @param readFrom the oldest time the rows were read from
 * @returns {{ from, clipped } | null} `clipped`: the stay runs on before
 *   `readFrom` (it was already held where the rows begin), so it began
 *   before `from`; null when the history does not hold the dog at `at`.
 */
export function indoorStayStart(answer, options = {}) {
  const stay = historyStayAt(answer, options);
  return stay && { from: stay.from, clipped: stay.clipped };
}

/**
 * The same 室內 stay, with the history's hold of its newest row at or before
 * `at`: where the history draws the dog (the anchor), why and since when.
 * @returns {{ from, clipped, hold: { coordinate, reason, since, source } | null } | null}
 */
export function historyStayAt({ rows = [], seed = [] } = {}, { at, readFrom = -Infinity, config = DOG } = {}) {
  if (!Number.isFinite(at) || !rows.length) return null;
  const stream = historySourceStream(rows, { replayHolds: packets => applyHistoryHolds(packets, { seed }) });
  const context = filterHistoryPoints(stream.points, { subject: 'dog', config });
  // A stay that reaches `at`: its newest row at most a packet gap before it.
  const node = historyIndoorNodes(context, { config })
    .filter(candidate => candidate.start <= at && candidate.end >= at - config.gapMs).pop();
  if (!node) return null;
  const newest = context.filter(point => point.time <= at).pop();
  const hold = newest?.heldReason && newest.heldSource !== 'ride' && newest.time >= at - config.gapMs
    ? { coordinate: { latitude: Number(newest.latitude), longitude: Number(newest.longitude) },
      reason: newest.heldReason, since: newest.heldSince, source: newest.heldSource }
    : null;
  return { from: Math.min(node.start, at),
    clipped: node.heldSince < readFrom && node.start - readFrom <= config.gapMs, hold };
}

/**
 * The dogs the live map does not hold although its rows may begin inside a
 * hold (HoldStore statuses: no trusted good fix since `rowsFrom`, a cold
 * start's half hour of drift): the live tracker can only start a hold from
 * the fixes it sees, so a dog indoors since last night may never be held
 * while the history, replaying the day, holds it all along.
 * @returns [{ slaveId, at }] `at`: the dog's newest row
 */
export function historyHoldCandidates(statuses = {}, holds = {}) {
  const result = [];
  for (const [id, status] of Object.entries(statuses || {})) {
    const slaveId = Number(id);
    if (holds?.[slaveId] || !Number.isFinite(status?.rowsFrom) || !Number.isFinite(status?.newestAt)) continue;
    if (Number.isFinite(status.lastGoodAt) && status.lastGoodAt >= status.rowsFrom) continue;
    result.push({ slaveId, at: status.newestAt });
  }
  return result.sort((left, right) => left.slaveId - right.slaveId);
}

/**
 * The history's holds for historyHoldCandidates(), so the map's 「室內」, the
 * card's 位置 row and the history say the same thing about one dog: each
 * candidate's history rows of the last CARD_INDOOR_LOOKBACK_MS are read (one
 * dog at a time), again when its newest row moved on by CARD_INDOOR_RETRY_MS.
 * @returns { [slaveId]: hold } in HoldStore.holds() form (`from`,
 *   `fromClipped` for the card's minutes), only for current candidates
 */
export function useHistoryHolds(read, candidates, { owner = null, busy = false } = {}) {
  const [found, setFound] = useState({ owner: null, read: null, dogs: {} });
  const known = useRef(found);
  known.current = found;
  const scope = useRef({ owner, read });
  scope.current = { owner, read };
  // One read at a time, and a read is not dropped when a newer row comes in
  // meanwhile (a packet every 30 s; a day's read can take longer than that).
  const queue = useRef({ chain: Promise.resolve(), pending: new Set() });
  useEffect(() => () => { scope.current = null; }, []);
  const key = JSON.stringify(candidates.map(candidate => [candidate.slaveId, candidate.at]));
  useEffect(() => {
    if (!read || busy || !candidates.length) return;
    for (const { slaveId, at } of candidates) {
      const previous = known.current.owner === owner && known.current.read === read
        ? known.current.dogs[slaveId] : null;
      if (queue.current.pending.has(slaveId)
        || (previous && at - previous.at < CARD_INDOOR_RETRY_MS && at >= previous.at)) continue;
      queue.current.pending.add(slaveId);
      queue.current.chain = queue.current.chain.then(async () => {
        let hold = null;
        try {
          const start = at - CARD_INDOOR_LOOKBACK_MS;
          const answer = await read({ subject: 'dog', slaveId, start, end: at + 1, owner });
          const stay = historyStayAt(answer, { at, readFrom: start - HISTORY_DAY_CONTEXT_MS });
          if (stay?.hold) hold = { ...stay.hold, from: stay.from, ...(stay.clipped ? { fromClipped: true } : {}) };
        } catch (error) {
          logger.warn('[Indoor hold] history read failed', error?.message);
        } finally {
          queue.current.pending.delete(slaveId);
        }
        if (scope.current?.owner !== owner || scope.current?.read !== read) return;
        setFound(current => {
          const base = current.owner === owner && current.read === read ? current.dogs : {};
          return { owner, read, dogs: { ...base, [slaveId]: { at, hold } } };
        });
      });
    }
    // key stands for candidates.
  }, [read, busy, key, owner]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const result = {};
    if (found.owner !== owner || found.read !== read) return result;
    for (const { slaveId, at } of candidates) {
      const entry = found.dogs[slaveId];
      // A finding is about the rows up to its read: a newer row the live
      // tracker saw (a good fix) has already dropped the dog from candidates.
      if (entry?.hold && at - entry.at < CARD_INDOOR_RETRY_MS * 2) result[slaveId] = entry.hold;
    }
    return result;
  }, [found, owner, read, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The open card's indoor stay, for a dog whose live hold may have begun before
 * the live rows (`heldFromClipped`): read once per hold start, and again after
 * a new download (`revision`) only while the start is not known, at most
 * every CARD_INDOOR_RETRY_MS.
 * @param read HistoryDatabase.historyDayRows (useMapHistory `readDay`), or null
 * @returns null (nothing to ask), { state: 'pending' }, { state: 'unknown' }
 *   (no history rows hold it there, or the read failed) or
 *   { state: 'found', from, clipped }
 */
export function useCardIndoorStay(read, dog, { owner = null, busy = false, revision = 0, now = Date.now } = {}) {
  const slaveId = dog?.slaveId ?? null;
  const at = dog?.heldFromClipped && Number.isFinite(dog.heldFrom) ? dog.heldFrom : null;
  const key = read && slaveId != null && at != null ? JSON.stringify([owner ?? null, slaveId, at]) : null;
  const [state, setState] = useState({ key: null, revision: null, at: null, result: null });
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    if (!key || busy) return undefined;
    const known = current.current.key === key ? current.current : null;
    if (known && (known.revision === revision || (known.result.state === 'found' && !known.result.clipped)
      || now() - known.at < CARD_INDOOR_RETRY_MS)) return undefined;
    let alive = true;
    const start = at - CARD_INDOOR_LOOKBACK_MS;
    (async () => {
      let result;
      try {
        const answer = await read({ subject: 'dog', slaveId, start, end: at, owner });
        const stay = indoorStayStart(answer, { at, readFrom: start - HISTORY_DAY_CONTEXT_MS });
        result = stay ? { state: 'found', ...stay } : { state: 'unknown' };
      } catch (error) {
        logger.warn('[Dog card] indoor stay read failed', error?.message);
        result = { state: 'unknown' };
      }
      // A finding for this hold outlives a newer read that found nothing.
      if (alive) setState(previous => ({ key, revision, at: now(), result: previous.key === key
        && previous.result?.state === 'found' && result.state !== 'found' ? previous.result : result }));
    })();
    return () => { alive = false; };
  }, [key, busy, revision, read, slaveId, at, owner, now]);
  if (!key) return null;
  return state.key === key ? state.result : PENDING;
}
