// A4 downloads the cloud days it needs (2026-10-21 user decision): the day
// shown, and the days of the week or month shown, when they are not on this
// phone yet. Nothing here downloads by itself: the history's adapter does
// (HistoryCloud: `downloadStates`, `missingRows`, `download`), so a day A4
// downloaded is proven for 看軌跡 too, and the other way round.
//
// A day needs nothing when its proof covers it (the check 看軌跡 makes:
// history_download_state through coversHistory), or when this phone already
// holds every row the cloud has for it (one count, HistoryCloud.missingRows:
// the automatic sync brings most days without a proof). The rest are
// downloaded one at a time, newest first, up to half of the phone's cloud
// cache. 年 downloads nothing (a year of one dog is ~5 million rows, far past
// the cache): it only finds the months with rows missing, and the page says so.
import { useCallback, useEffect, useRef, useState } from 'react';
import { activityPeriod } from './views';
import { coversHistory, historyCoverage } from '../cloud/HistoryCoverage';
import { serverClock } from '../cloud/ServerClock';
import { captureActivityRead } from '../cloud/CloudPagePublication';
import { CLOUD_MAX_ROWS } from '../cloud/CloudDatabase';
import { dayBounds, dayKey } from '../history/screen/HistoryScreenDates';

// ‹ › tapped quickly ask nothing until they settle on a period.
export const ACTIVITY_DOWNLOAD_SETTLE_MS = 600;
// The period is read again at most this often while days come in (a month
// is a long read), and once more when the last one is done.
export const ACTIVITY_REREAD_MS = 4000;
// One plan downloads at most this many rows (the cloud's counts): a month of
// one dog (~430,000) fits; more would push its own oldest days out of the
// cache again (the cap drops the oldest received first).
export const ACTIVITY_DOWNLOAD_BUDGET_ROWS = Math.floor(CLOUD_MAX_ROWS / 2);
// Every manual download stops the automatic archive (runManual). Between two
// days, an archive older than this gets its round first (at most
// ARCHIVE_WAIT_MS), so a month of downloads never holds the archive off.
export const ARCHIVE_BREATH_MS = 2 * 60000;
export const ARCHIVE_WAIT_MS = 60000;
// A plan whose proof and counts were read across a publication reads again
// this many times, then waits for the next publication.
const FENCE_TRIES = 3;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextDay = start => {
  const date = new Date(start);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

/** The day keys of the period containing `date`, up to `now`, newest first. */
export function periodDays(mode, date, now) {
  const period = activityPeriod(mode, Math.min(date, now));
  const days = [];
  for (let start = period.start; start < period.end && start <= now; start = nextDay(start)) {
    days.push(dayKey(new Date(start)));
  }
  return days.reverse();
}

/** 年: its months up to `now`, newest first: { start, end }. */
export function periodMonths(date, now) {
  const year = new Date(activityPeriod('year', Math.min(date, now)).start).getFullYear();
  const months = [];
  for (let month = 0; month < 12; month += 1) {
    const start = new Date(year, month, 1).getTime();
    if (start > now) break;
    months.push({ start, end: new Date(year, month + 1, 1).getTime() });
  }
  return months.reverse();
}

/** The days whose proof (history_download_state) does not cover them at `cutoff`. */
export function unprovenDays(days, states = [], { slaveId, cutoff, serverOffset = 0 }) {
  return days.filter(day => {
    const { dayStart, dayEnd } = dayBounds(day);
    const row = states.find(state => state.slave_id === slaveId && state.day === day);
    return !coversHistory(row, historyCoverage(dayStart, dayEnd, cutoff, serverOffset));
  });
}

/** The newest-first days that fit `budget` rows (the first always does). */
export function withinBudget(days, counts, budget = ACTIVITY_DOWNLOAD_BUDGET_ROWS) {
  let used = 0;
  const fits = [];
  for (const day of days) {
    const rows = Number(counts[day]) || 0;
    if (fits.length && used + rows > budget) break;
    used += rows;
    fits.push(day);
  }
  return fits;
}

const IDLE = Object.freeze({ status: 'idle', day: null, done: 0, total: 0, missing: [], months: [], left: 0 });
// Statuses during which the page must not say 沒有資料 (it is not known yet).
export const ACTIVITY_DOWNLOAD_PENDING = Object.freeze(['pending', 'waiting', 'checking', 'downloading']);

/**
 * @param cloud HistoryCloud's adapter (null signed out: nothing happens)
 * @param online whether the last sync pass reached the cloud
 * @param publication the screen's publication revision (a plan waiting for
 *   the archive's publication tries again when it changes)
 * @returns {{ status: 'idle'|'pending'|'waiting'|'checking'|'downloading'|'offline'|'failed'
 *   |'cancelled'|'partial', day, done, total, missing: string[], months: number[], left,
 *   revision, retry, cancel }}
 *   `missing`: the days not downloaded (offline: the days not proven);
 *   `months`: 年's months with rows missing (their starts); `left`: days the
 *   budget or the cache left out; `revision` changes when downloaded days
 *   should be read
 */
export function useActivityDownloads({ cloud, online = true, slaveId, mode, date, now, active = true,
  publication = 0, settleMs = ACTIVITY_DOWNLOAD_SETTLE_MS }) {
  const period = activityPeriod(mode, Math.min(date, now));
  const key = `${cloud?.owner ?? ''}|${slaveId}|${mode}|${period.start}`;
  const [state, setState] = useState({ key: null, ...IDLE });
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const running = useRef(null);
  // The clock only matters through the period (`key`): read it from here.
  const clock = useRef(now);
  clock.current = now;
  const enabled = !!cloud && active && slaveId != null;
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    running.current = controller;
    let alive = true, lastRead = 0, readTimer = null;
    const current = () => alive && !controller.signal.aborted;
    // Unmounted or moved on: stop quietly; 取消: stop and say so (catch).
    const STOP = {};
    const check = () => {
      if (!alive) throw STOP;
      if (controller.signal.aborted) throw new Error('cancelled');
    };
    const show = value => { if (alive) setState({ key, ...IDLE, ...value }); };
    const reread = (final = false) => {
      if (!alive) return;
      clearTimeout(readTimer);
      const wait = final ? 0 : Math.max(0, lastRead + ACTIVITY_REREAD_MS - Date.now());
      readTimer = setTimeout(() => {
        if (!alive) return;
        lastRead = Date.now();
        setRevision(value => value + 1);
      }, wait);
    };
    // Between two downloads: an archive that has not published for a while
    // (the downloads stopped it) gets a round first.
    const breathe = async () => {
      const before = cloud.getPublication?.();
      if (!Number.isFinite(before?.archiveCutoff) || Date.now() - before.archiveCutoff <= ARCHIVE_BREATH_MS) return;
      for (const until = Date.now() + ARCHIVE_WAIT_MS; Date.now() < until && current();) {
        await pause(1000);
        if (cloud.getPublication?.()?.archiveRevision !== before.archiveRevision) return;
      }
    };
    // The proof and the counts of one coherent publication (as the history's
    // proof read, useHistoryCloud): { plan } or null (wait for the next one).
    const decide = async (days, cutoff, serverOffset) => {
      for (let tries = 0; tries < FENCE_TRIES; tries += 1) {
        const fence = captureActivityRead(cloud.getPublication, cloud.owner, !!cloud.publishedReads);
        if (!fence.open) return null;
        const states = cloud.downloadStates ? await cloud.downloadStates({ slaveId }) : [];
        check();
        const unproven = unprovenDays(days, states, { slaveId, cutoff, serverOffset });
        if (!unproven.length) return { unproven, missing: [], counts: {} };
        if (!online) return { unproven, offline: true };
        show({ status: 'checking', missing: unproven });
        const missing = [], counts = {};
        for (const day of unproven) {
          const { dayStart, dayEnd } = dayBounds(day);
          const answer = cloud.missingRows ? await cloud.missingRows({ slaveId, dayStart, dayEnd, cutoff,
            serverOffset, signal: controller.signal }) : { missing: true };
          check();
          if (answer?.missing) { missing.push(day); counts[day] = Math.max(0, (answer.cloud ?? 0) - (answer.local ?? 0)); }
        }
        if (fence.valid()) return { unproven, missing, counts };
      }
      return null;
    };
    const timer = setTimeout(async () => {
      // A clock fixed for this plan: the proof, the count and the download
      // agree on it (HistoryCoverage), as 看軌跡's download does.
      const cutoff = clock.current;
      const serverOffset = serverClock.offset();
      let missing = [], done = 0;
      try {
        if (mode === 'year') {
          if (!online || !cloud.missingRows) { show({}); return; }
          show({ status: 'checking' });
          const months = [];
          for (const month of periodMonths(period.start, cutoff)) {
            const answer = await cloud.missingRows({ slaveId, dayStart: month.start, dayEnd: month.end,
              cutoff, serverOffset, signal: controller.signal });
            check();
            if (answer?.missing) months.push(month.start);
          }
          show(months.length ? { status: 'partial', months } : {});
          return;
        }
        const days = periodDays(mode, period.start, cutoff);
        const plan = await decide(days, cutoff, serverOffset);
        check();
        if (plan === null) { show({ status: 'waiting' }); return; }
        if (plan.offline) { show({ status: 'offline', missing: plan.unproven }); return; }
        if (!plan.missing.length) { show({}); return; }
        missing = withinBudget(plan.missing, plan.counts);
        const skipped = plan.missing.length - missing.length;
        for (const day of missing) {
          if (done) await breathe();
          check();
          show({ status: 'downloading', day, done, total: missing.length, missing });
          const { dayStart, dayEnd } = dayBounds(day);
          await cloud.download({ slaveId, dayStart, dayEnd, cutoff, serverOffset, signal: controller.signal });
          check();
          done += 1;
          if (done < missing.length) reread();
        }
        // Downloaded is not the same as still here: a full cache may already
        // have dropped some of them again (their proof is withdrawn). Those
        // are not downloaded once more in this plan.
        let gone = 0;
        if (cloud.downloadStates) {
          const states = await cloud.downloadStates({ slaveId });
          check();
          gone = unprovenDays(missing, states, { slaveId, cutoff, serverOffset }).length;
        }
        show(skipped + gone ? { status: 'partial', left: skipped + gone } : {});
        reread(true);
      } catch (error) {
        if (!alive || error === STOP) return;
        // What finished before stays on the page.
        const left = missing.slice(done);
        show({ status: controller.signal.aborted ? 'cancelled' : 'failed',
          missing: left.length ? left : periodDays(mode, period.start, cutoff), done, total: missing.length });
        if (done) reread(true);
      }
    }, settleMs);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(readTimer);
      controller.abort();
      if (running.current === controller) running.current = null;
    };
    // `period` is `key`; the clock is read from `clock`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, online, attempt, cloud, settleMs]);
  // Waiting for a coherent publication: the next one tries again.
  const waiting = enabled && state.key === key && state.status === 'waiting';
  useEffect(() => {
    if (waiting) setAttempt(value => value + 1);
  }, [publication]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  /** 取消: the running download stops (what it saved stays, HistoryCloud). */
  const cancel = useCallback(() => running.current?.abort(), []);
  // Before this period's plan has answered, nothing is known yet (the page
  // must not say 沒有資料 during the settle either).
  const shown = !enabled ? IDLE : state.key === key ? state : { ...IDLE, status: 'pending' };
  return { ...shown, revision, retry, cancel };
}
