import { useEffect, useRef, useState } from 'react';
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
export function indoorStayStart({ rows = [], seed = [] } = {}, { at, readFrom = -Infinity, config = DOG } = {}) {
  if (!Number.isFinite(at) || !rows.length) return null;
  const stream = historySourceStream(rows, { replayHolds: packets => applyHistoryHolds(packets, { seed }) });
  const context = filterHistoryPoints(stream.points, { subject: 'dog', config });
  // A stay that reaches `at`: its newest row at most a packet gap before it.
  const node = historyIndoorNodes(context, { config })
    .filter(candidate => candidate.start <= at && candidate.end >= at - config.gapMs).pop();
  if (!node) return null;
  return { from: Math.min(node.start, at),
    clipped: node.heldSince < readFrom && node.start - readFrom <= config.gapMs };
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
