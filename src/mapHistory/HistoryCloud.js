import { coversHistory, historyCoverage } from '../cloud/HistoryCoverage';
import { t } from '../i18n';
// What the history's calendar asks the cloud (054b): which days hold the
// rows of the dog (or dogs, 055b) (H3b's dots), the earliest one (how far back ‹ goes), and the
// download of a day only the cloud holds (H3c). The download is the cloud
// page's writer (downloadCloudHistory → CloudDatabase.savePage) through the
// sync's exclusive slot (runManual), so it never races the 30-second sync.
// Signed out there is no adapter at all: nothing is asked.
import { dayKey } from '../history/screen/HistoryScreenDates';
import { useMemo, useRef } from 'react';
import { downloadCloudHistory } from '../cloud/CloudDownload';
import { createMalformedFields } from '../models/MalformedFields';
import { getCloudClient } from '../cloud/CloudClient';
import { serverClock } from '../cloud/ServerClock';

// 判定表「月曆查詢雲端失敗」: a question unanswered after 10 s has failed.
export const CLOUD_QUESTION_MS = 10000;
// A day's download reaches past the day by upload time: the half hour before
// (the list's context) and two hours after (rows uploaded late).
export const DOWNLOAD_BEFORE_MS = 30 * 60000;
export const DOWNLOAD_AFTER_MS = 2 * 3600000;
// A retained prefix may miss rows committed just before its cutoff but not yet
// visible to that query; the tail re-reads this much (as the automatic sync).
export const TAIL_OVERLAP_MS = 5 * 60000;
// The night before: the day's rows start DOWNLOAD_BEFORE_MS before it, and the
// hold pass is seeded with the last good fixes before that (HistoryDatabase
// historyDayRows), so a stay carried over from the day before (「接續前一天」)
// needs what was received before the window too. The automatic archive has
// it once it has published past the window's start; until then a day's
// download also fetches what the archive still lacks, at most this far back.
export const CARRY_OVER_MS = 24 * 3600000;
// missingRows: the automatic archive is current when it published at most
// this long before the question; then the rows received after its cutoff are
// its next round's (every 30 s). An archive further behind (catching up,
// failing) proves nothing past its cutoff, so the whole window is counted.
export const ARCHIVE_CURRENT_MS = 5 * 60000;
// missingRows: a closed window's cloud count is asked again after this long
// (a Master that buffered offline can still upload into it, CloudReconcile).
export const COUNT_KEEP_MS = 10 * 60000;

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
    if (error) throw new Error(error.message || t("c809"));
    if (!Array.isArray(data)) throw new Error(t("c578"));
    if (!data.length) return null;
    const time = Date.parse(data[0].received_at);
    return Number.isFinite(time) ? time : null;
  } catch (error) {
    if (limit.signal.aborted && !signal?.aborted) throw new Error(t("c811"));
    throw error;
  } finally {
    limit.done();
  }
}

async function countOnce(query, signal, ms) {
  const limit = limited(signal, ms);
  try {
    const { count, error } = await query.abortSignal(limit.signal);
    if (error) throw new Error(error.message || t("c809"));
    if (!Number.isInteger(count) || count < 0) throw new Error(t("c578"));
    return count;
  } catch (error) {
    if (limit.signal.aborted && !signal?.aborted) throw new Error(t("c811"));
    throw error;
  } finally {
    limit.done();
  }
}

/**
 * `client` the Supabase client, `database` the cloud database (savePage),
 * `owner` the account, `runManual(work, abort)` the sync's slot.
 */
export function createHistoryCloud({ client, database, owner, runManual, getPublication = null, questionMs = CLOUD_QUESTION_MS }) {
  // One dog, or the dogs shown together (H7: a day of any of them has a dot).
  const rows = slaveId => {
    const query = client.from('dog_telemetry').select('received_at');
    return Array.isArray(slaveId) ? query.in('slave_id', slaveId) : query.eq('slave_id', slaveId);
  };
  // One download at a time: a cancelled one keeps the sync's slot until it
  // has stopped, so the next waits for it instead of being refused.
  let previous = Promise.resolve();
  // `${dog}:${window start}` whose night before was fetched and published
  // (this process): a later tail of the same day does not fetch it again.
  const carried = new Set();
  // missingRows: the cloud's count of a closed window, per
  // `${dog}:${from}:${to}`: { count, at } (this phone's clock).
  const counted = new Map();
  return {
    owner,
    coverageRequired: true,
    getPublication,
    publishedReads: typeof database.publishManualScope === 'function',
    downloadStates: ({ slaveId }) => database.historyDownloadStates?.(owner, slaveId) ?? Promise.resolve([]),
    /**
     * The time of the dog's newest row in [since, cutoff), or null. The
     * bounds and the answer are on this phone's clock; the question is asked
     * in received_at (the server's clock), moved by `serverOffset` (#186), so
     * a phone whose clock is off does not put a day's rows on its neighbour.
     */
    async newestBefore({ slaveId, cutoff, since, signal, serverOffset = serverClock.offset() }) {
      const offset = Number.isFinite(serverOffset) ? serverOffset : 0;
      const time = await oneTime(rows(slaveId).gte('received_at', iso(since + offset)).lt('received_at', iso(cutoff + offset))
        .order('received_at', { ascending: false }).limit(1), signal, questionMs);
      return time == null ? null : time - offset;
    },
    /** The time of the dog's oldest row (this phone's clock), or null. */
    async earliest({ slaveId, signal, serverOffset = serverClock.offset() }) {
      const offset = Number.isFinite(serverOffset) ? serverOffset : 0;
      const time = await oneTime(rows(slaveId).order('received_at', { ascending: true }).limit(1), signal, questionMs);
      return time == null ? null : time - offset;
    },
    /**
     * Whether the cloud holds rows of the dog's day that this phone lacks (A4,
     * 2026-10-21): one count, the way the hourly reconcile asks
     * (CloudReconcile), instead of downloading a day the automatic sync has
     * already brought (~15 requests and 14,000 rows a dog-day). The window
     * is the download's main one by reception time: from DOWNLOAD_BEFORE_MS
     * before the day to its proof's `received_before`. A4 reads by track
     * time with 13 minutes either side; those rows were received inside
     * this window, except phone uploads that reached the cloud late. Those
     * have a later reception time, so the automatic archive has them
     * whenever it has the day's own rows, and the cache drops oldest
     * reception first. When the archive is current (ARCHIVE_CURRENT_MS) the
     * window stops at its cutoff: what came after is its next round's.
     * Rows on this phone only ever come from the cloud, one per event, so
     * fewer here means some are missing. No proof is written from a count
     * (HistoryCoverage: a proof is a completed download).
     * @returns {{ missing: boolean, cloud: number, local: number }}
     */
    async missingRows({ slaveId, dayStart, dayEnd, cutoff = Date.now(), serverOffset = serverClock.offset(), signal, at = Date.now() }) {
      const offset = Number.isFinite(serverOffset) ? serverOffset : 0;
      const from = dayStart - DOWNLOAD_BEFORE_MS;
      const whole = historyCoverage(dayStart, dayEnd, cutoff, offset).received_before;
      let archived = null;
      if (typeof database.readArchivePublication === 'function') {
        try { archived = (await database.readArchivePublication(owner))?.cutoff ?? null; } catch { archived = null; }
      }
      const current = Number.isFinite(archived) && cutoff - archived <= ARCHIVE_CURRENT_MS;
      const to = current ? Math.min(whole, archived) : whole;
      if (!(to > from)) return { missing: false, cloud: 0, local: 0 };
      const key = `${slaveId}:${from}:${to}`;
      const kept = counted.get(key);
      let cloud = kept && at - kept.at < COUNT_KEEP_MS ? kept.count : null;
      if (cloud == null) {
        cloud = await countOnce(client.from('dog_telemetry').select('event_id', { count: 'exact', head: true })
          .eq('slave_id', slaveId).gte('received_at', iso(from)).lt('received_at', iso(to)), signal, questionMs);
        // The day's whole window, already past on the server's clock: closed.
        if (to === dayEnd + DOWNLOAD_AFTER_MS && to <= cutoff + offset) counted.set(key, { count: cloud, at });
      }
      if (signal?.aborted) throw new Error(t("c576"));
      const local = cloud > 0 ? await database.countSlaveRange(owner, slaveId, from, to) : 0;
      return { missing: local < cloud, cloud, local };
    },
    /**
     * Downloads the dog's (or dogs') rows of [dayStart, dayEnd) into this phone.
     * `cutoff` is this phone's clock; the queries and the proof are cut at the
     * same moment on the server's clock (`serverOffset`, HistoryCoverage).
     */
    download({ slaveId, dayStart, dayEnd, cutoff = Date.now(), serverOffset = serverClock.offset(), signal, onDogEnd }) {
      const offset = Number.isFinite(serverOffset) ? serverOffset : 0;
      const coverage = historyCoverage(dayStart, dayEnd, cutoff, offset);
      // received_at (the server's clock) of `cutoff`.
      const serverCutoff = cutoff + offset;
      // A proof up to a received_at, as the coverage of the phone-clock cutoff
      // that cuts there.
      const coverageTo = received => historyCoverage(dayStart, dayEnd, received - offset, offset);
      const before = previous;
      const run = (async () => {
        await before.catch(() => {});
        if (signal?.aborted) throw new Error(t("c576"));
        await database.initialize();
        const ids = Array.isArray(slaveId) ? slaveId : [slaveId];
        const day = dayKey(new Date(dayStart));
        // `abort` ends the sync slot's lease, `network` this download's
        // requests. A cancel stops the requests at once; while a dog's window
        // is being paged (`keeping`) the lease stays until the pages already
        // saved are published as a completed prefix, so the next download of
        // the day resumes from there (2026-10-15: a cancelled first download
        // kept nothing and the day was downloaded again from its start).
        const abort = new AbortController(), network = new AbortController();
        let keeping = false;
        const cancel = () => { network.abort(); if (!keeping) abort.abort(); };
        if (signal?.aborted) cancel();
        signal?.addEventListener?.('abort', cancel);
        // By upload time (received_at): rows shown on this day by their fix
        // time can arrive a little before it and up to a while after it.
        // `db`: the lease's own commands when the sync passes them
        // (runManual), which do not wait at the archive-priority gate.
        // Fields read as unknown (MalformedFields): one line for this download.
        const malformed = createMalformedFields();
        const work = async (leaseCurrent, publishScoped, db = database) => {
          let count = 0, failure = null;
          // A retained completed prefix can be extended by reception-time tail.
          // Missing/evicted/legacy proof always downloads the entire window.
          const previousStates = await db.historyDownloadStates?.(owner, ids) ?? [];
          // The dog's stored proof when it is a completed prefix of this window.
          const prefixOf = id => {
            const proof = previousStates.find(row => row.slave_id === id && row.day === day);
            if (!Number.isFinite(proof?.received_before) || proof.received_before >= coverage.received_before) return null;
            return coversHistory(proof, coverageTo(proof.received_before)) ? proof : null;
          };
          const tailStart = id => {
            const proof = prefixOf(id);
            return proof ? Math.max(dayStart - DOWNLOAD_BEFORE_MS, proof.received_before - TAIL_OVERLAP_MS)
              : dayStart - DOWNLOAD_BEFORE_MS;
          };
          // A retained completed prefix stays true while its tail downloads:
          // rows only arrive in a staged scope, and eviction/repair already
          // invalidate proof on their own. Wiping it would throw away the
          // tail cursor of an interrupted refresh and publish an unknown
          // material revision, so readers fully re-read twice per refresh.
          // Only a dog downloading its entire window loses its old proof.
          const restart = ids.filter(id => !prefixOf(id));
          // What the automatic archive still lacks before the window (device
          // 0.3.179: opened 01:28 after a long time away, the archive had not
          // reached the evening before; 「01:21 出發」 instead of the 81-minute
          // stay 「00:00 接續前一天」 the same day showed four minutes later).
          const windowStart = dayStart - DOWNLOAD_BEFORE_MS;
          let archived = null;
          if (typeof db.readArchivePublication === 'function') {
            try { archived = (await db.readArchivePublication(owner))?.cutoff ?? null; } catch { archived = null; }
          }
          const carryFrom = typeof db.readArchivePublication !== 'function' ? windowStart
            : Math.max(windowStart - CARRY_OVER_MS, Number.isFinite(archived) ? archived - TAIL_OVERLAP_MS : -Infinity);
          const markIncomplete = async () => {
            for (const id of restart) await db.setHistoryDownloadState?.(owner, id, day, false);
          };
          if (restart.length && publishScoped) await publishScoped(markIncomplete);
          else if (restart.length) await markIncomplete();
          const current = () => !network.signal.aborted && !abort.signal.aborted && leaseCurrent();
          // What a cancelled window keeps: the proof of the rows received
          // before `received` (all saved: pages run in reception order), and
          // those rows, published with the lease like a finished day.
          const keep = async (id, received, carry) => {
            await db.setHistoryDownloadState?.(owner, id, day, true, coverageTo(received));
            if (db.publishManualScope) {
              const commit = () => db.publishManualScope(owner, id, day, () => !abort.signal.aborted && leaseCurrent());
              if (publishScoped) await publishScoped(commit);
              else await commit();
            }
            if (carry) carried.add(carry);
          };
          for (const id of ids) {
            if (!current()) throw new Error(t("c576"));
            // The reception time this dog's window is saved up to (exclusive).
            let kept = null, carryDone = null;
            try {
              await db.beginManualScope?.(owner, id, day);
              if (!current()) throw new Error(t("c576"));
              const carry = `${id}:${windowStart}`, carryStart = carried.has(carry) ? windowStart : carryFrom;
              if (carryStart < windowStart) count += await downloadCloudHistory({ client, database: db, owner,
                startAt: iso(carryStart), endBefore: iso(windowStart), slaveId: id,
                signal: network.signal, isCurrent: current, malformed });
              carryDone = carryStart < windowStart ? carry : null;
              keeping = true;
              if (!current()) throw new Error(t("c576"));
              count += await downloadCloudHistory({ client, database: db, owner,
                startAt: iso(tailStart(id)), endBefore: iso(coverage.received_before), slaveId: id,
                signal: network.signal, isCurrent: current, malformed,
                onProgress: (processed, last) => { if (Number.isFinite(last?.received_at)) kept = last.received_at; } });
              // History is bucketed by track time: a phone packet of this day can
              // reach the cloud after the reception window. Before proving a
              // closed day complete, also fetch those late phone rows.
              if (coverage.received_before < serverCutoff) {
                // Interrupted here, the window is kept short of its end, so
                // the next download fetches these again.
                kept = coverage.received_before - 1;
                count += await downloadCloudHistory({ client, database: db, owner,
                  startAt: iso(coverage.received_before), endBefore: iso(serverCutoff), slaveId: id,
                  phoneTrack: { startAt: iso(dayStart - DOWNLOAD_BEFORE_MS), endBefore: iso(coverage.range_end) },
                  signal: network.signal, isCurrent: current, malformed });
              }
              keeping = false;
              if (!current()) throw new Error(t("c576"));
              await db.setHistoryDownloadState?.(owner, id, day, true, coverage);
              if (!current()) throw new Error(t("c576"));
              if (db.publishManualScope) {
                const commit = () => db.publishManualScope(owner, id, day, () => !abort.signal.aborted && leaseCurrent());
                if (publishScoped) await publishScoped(commit);
                else await commit();
              }
              if (carryDone) carried.add(carryDone);
              onDogEnd?.(id, 'done');
            } catch (error) {
              const cancelled = network.signal.aborted;
              // Worth keeping only past the window's start and the dog's own
              // earlier proof; a failed keep leaves the day as it was. A
              // failed request (the network gone mid-window) keeps the same
              // saved prefix as a cancel: the pages before it were saved in
              // reception order, so 重試 resumes from there.
              const from = prefixOf(id)?.received_before ?? dayStart - DOWNLOAD_BEFORE_MS;
              if (keeping && kept != null && kept > from && !abort.signal.aborted && leaseCurrent())
                await keep(id, kept, carryDone).catch(() => {});
              keeping = false;
              if (cancelled) abort.abort();
              onDogEnd?.(id, cancelled || abort.signal.aborted ? 'cancelled' : 'failed');
              if (abort.signal.aborted || !leaseCurrent()) throw error;
              failure = error;
            }
          }
          if (failure) throw failure;
          return count;
        };
        try { return await (runManual ? runManual(work, abort) : work(() => true)); }
        finally { malformed.report('history'); }
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
      getPublication: () => syncRef.current?.getHistoryPublication?.() ?? syncRef.current?.getMapPublication?.() ?? null,
      runManual: (work, abort) => syncRef.current.runManual(work, abort) });
  }, [owner, database, clientFactory]);
  return { cloud, online: !sync?.offline };
}
