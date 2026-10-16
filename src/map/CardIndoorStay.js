import { useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../logger';
import { historyPackets, historySourceStream, filterHistoryPoints } from '../history/HistorySources';
import { historyIndoorNodes } from '../history/HistoryStops';
import { configFor } from '../history/HistoryConfig';
import { applyHistoryHolds, createHistoryHolds } from '../placement/IndoorHold';
import { HISTORY_DAY_CONTEXT_MS } from '../mapHistory/HistoryDatabase';

// The live map's hold rows begin half an hour back on a cold start
// (HoldStore.HOLD_LOOKBACK_MS): a dog the live tracker cannot hold from them
// is held where the history holds it (useHistoryHolds), reading the history's
// rows at most this far back. (The card no longer times a stay, 2026-10-16:
// it says 「室內」 and the address, so the open card asks the history nothing.)
export const CARD_INDOOR_LOOKBACK_MS = 24 * 3600000;

// A dog's history hold is asked again when its newest row moved on by this
// much (the read covers a day of rows).
export const CARD_INDOOR_RETRY_MS = 5 * 60000;

const DOG = configFor('dog');

/**
 * The history's 室內 stay that holds the dog at `at`, read from the history's
 * rows (HistoryDatabase.historyDayRows: `rows`, `seed`) through the history's
 * own steps (historySourceStream → applyHistoryHolds → filterHistoryPoints →
 * historyIndoorNodes), with the hold of its newest row at or before `at`:
 * where the history draws the dog (the anchor), why and since when.
 * `clipped`: the stay runs on before `readFrom`.
 * @returns {{ from, clipped, hold: { coordinate, reason, since, source } | null } | null}
 */
export function historyStayAt({ rows = [], seed = [] } = {}, { at, readFrom = -Infinity, config = DOG, replayHolds = null } = {}) {
  if (!Number.isFinite(at) || !rows.length) return null;
  const stream = historySourceStream(rows, { replayHolds: replayHolds ?? (packets => applyHistoryHolds(packets, { seed })) });
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

// Packets the hold replay takes between two yields to the JS thread.
export const STAY_REPLAY_STEP = 250;
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * historyStayAt with its costly part — replaying a day of packets through the
 * hold tracker — done STAY_REPLAY_STEP packets at a time with the JS thread
 * free in between: done in one go it held the thread about a second for a dog
 * right after the App came back (2026-10-16). Same answer as historyStayAt.
 */
export async function historyStayAtSoon(answer = {}, options = {}) {
  const { rows = [], seed = [] } = answer;
  if (!Number.isFinite(options.at) || !rows.length) return null;
  const packets = historyPackets(rows);
  const pass = createHistoryHolds({ seed });
  for (let i = 0; i < packets.length; i += STAY_REPLAY_STEP) {
    pass.append(packets.slice(i, i + STAY_REPLAY_STEP));
    await nextTask();
  }
  // The pass copied each packet: the stream's own packets are left as they are.
  const replayHolds = () => pass.output;
  replayHolds.copiesPackets = true;
  return historyStayAt(answer, { ...options, replayHolds });
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
          const stay = await historyStayAtSoon(answer, { at, readFrom: start - HISTORY_DAY_CONTEXT_MS });
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
