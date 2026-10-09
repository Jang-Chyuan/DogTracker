// What the history's calendar asks the cloud (054b): which days hold the
// rows of the dog (or dogs, 055b) (H3b's dots), the earliest one (how far back ‹ goes), and the
// download of a day only the cloud holds (H3c). The download is the cloud
// page's writer (downloadCloudHistory → CloudDatabase.savePage) through the
// sync's exclusive slot (runManual), so it never races the 30-second sync.
// Signed out there is no adapter at all: nothing is asked.
import { dayKey } from '../history/screen/HistoryScreenDates';
import { useMemo, useRef } from 'react';
import { downloadCloudHistory } from '../cloud/CloudDownload';
import { getCloudClient } from '../cloud/CloudClient';

// 判定表「月曆查詢雲端失敗」: a question unanswered after 10 s has failed.
export const CLOUD_QUESTION_MS = 10000;
// A day's download reaches past the day by upload time: the half hour before
// (the list's context) and two hours after (rows uploaded late).
export const DOWNLOAD_BEFORE_MS = 30 * 60000;
export const DOWNLOAD_AFTER_MS = 2 * 3600000;

const iso = value => new Date(value).toISOString();

/** `signal` plus a 10-second limit, as one signal; `done()` clears the timer. */
function limited(signal, ms) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener?.('abort', abort);
  const timer = setTimeout(abort, ms);
  return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener?.('abort', abort); } };
}

async function oneTime(query, signal, ms) {
  const limit = limited(signal, ms);
  try {
    const { data, error } = await query.abortSignal(limit.signal);
    if (error) throw new Error(error.message || '雲端的紀錄查不到');
    if (!Array.isArray(data)) throw new Error('雲端回傳格式不正確');
    if (!data.length) return null;
    const time = Date.parse(data[0].received_at);
    return Number.isFinite(time) ? time : null;
  } catch (error) {
    if (limit.signal.aborted && !signal?.aborted) throw new Error('雲端的紀錄查不到（逾時）');
    throw error;
  } finally {
    limit.done();
  }
}

/**
 * `client` the Supabase client, `database` the cloud database (savePage),
 * `owner` the account, `runManual(work, abort)` the sync's slot.
 */
export function createHistoryCloud({ client, database, owner, runManual, questionMs = CLOUD_QUESTION_MS }) {
  // One dog, or the dogs shown together (H7: a day of any of them has a dot).
  const rows = slaveId => {
    const query = client.from('dog_telemetry').select('received_at');
    return Array.isArray(slaveId) ? query.in('slave_id', slaveId) : query.eq('slave_id', slaveId);
  };
  // One download at a time: a cancelled one keeps the sync's slot until it
  // has stopped, so the next waits for it instead of being refused.
  let previous = Promise.resolve();
  return {
    owner,
    downloadStates: ({ slaveId }) => database.historyDownloadStates?.(owner, slaveId) ?? Promise.resolve([]),
    /** The time of the dog's newest row in [since, cutoff), or null. */
    newestBefore({ slaveId, cutoff, since, signal }) {
      return oneTime(rows(slaveId).gte('received_at', iso(since)).lt('received_at', iso(cutoff))
        .order('received_at', { ascending: false }).limit(1), signal, questionMs);
    },
    /** The time of the dog's oldest row, or null. */
    earliest({ slaveId, signal }) {
      return oneTime(rows(slaveId).order('received_at', { ascending: true }).limit(1), signal, questionMs);
    },
    /** Downloads the dog's (or dogs') rows of [dayStart, dayEnd) into this phone. */
    download({ slaveId, dayStart, dayEnd, signal }) {
      const before = previous;
      const run = (async () => {
        await before.catch(() => {});
        if (signal?.aborted) throw new Error('下載已取消');
        await database.initialize();
        const ids = Array.isArray(slaveId) ? slaveId : [slaveId];
        const day = dayKey(new Date(dayStart));
        for (const id of ids) await database.setHistoryDownloadState?.(owner, id, day, false);
        const abort = new AbortController();
        if (signal?.aborted) abort.abort();
        signal?.addEventListener?.('abort', () => abort.abort());
        // By upload time (received_at): rows shown on this day by their fix
        // time can arrive a little before it and up to a while after it.
        const work = leaseCurrent => downloadCloudHistory({ client, database, owner,
          startAt: iso(dayStart - DOWNLOAD_BEFORE_MS), endBefore: iso(dayEnd + DOWNLOAD_AFTER_MS), slaveId,
          signal: abort.signal, isCurrent: () => !abort.signal.aborted && leaseCurrent() });
        const count = await (runManual ? runManual(work, abort) : work(() => true));
        if (abort.signal.aborted) throw new Error('下載已取消');
        for (const id of ids) await database.setHistoryDownloadState?.(owner, id, day, true);
        return count;
      })();
      previous = run;
      return run;
    },
  };
}

/**
 * The adapter for the signed-in account (null signed out), and whether the
 * network is there: the last sync pass reached Supabase (useCloudSync's
 * `offline`). `sync` is useCloudSync's (its runManual borrows the slot).
 */
export function useHistoryCloudSource({ database, sync, owner, clientFactory = getCloudClient }) {
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const cloud = useMemo(() => {
    if (!owner || !database) return null;
    let client;
    try { client = clientFactory(); } catch { return null; }
    return createHistoryCloud({ client, database, owner,
      runManual: (work, abort) => syncRef.current.runManual(work, abort) });
  }, [owner, database, clientFactory]);
  return { cloud, online: !sync?.offline };
}
