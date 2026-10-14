import { t } from '../i18n';
import { logger } from '../logger';
import { bleUploadPayload } from './BleUploadPayload';
// Foreground and Headless JS use separate service objects in the same runtime.
let uploading = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/**
 * One pass: up to PASS_ROWS events, PASS_REQUESTS at a time, and no new
 * request after PASS_BUDGET_MS (the relay's JS task stops at 25 s). Passes are
 * 10 s apart (SearchRelayService, useCloudUpload), so at ~0.5 s a request
 * one pass sends 120 events in about 10 s: over 5 events/s, against 1 event/s
 * for two dogs every 2 s (__tests__/UploadQueueOutage.test.js). Today's
 * ingest-phone-telemetry takes one event per request; each event keeps its
 * own UUID, so a request cut off mid-pass is simply sent again.
 */
export const PASS_ROWS = 120;
export const PASS_REQUESTS = 6;
export const PASS_BUDGET_MS = 18000;
async function sessionUntilCancelled(auth, signal) {
  if (!signal) return auth.getSession();
  let cancel;
  const cancelled = new Promise(resolve => {
    cancel = () => resolve({ data: { session: null } });
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try { return await Promise.race([auth.getSession(), cancelled]); }
  finally { signal.removeEventListener('abort', cancel); }
}
// The outcome that ends a pass, most important first.
const STOPS = ['unauthorized', 'cancelled', 'retry'];
export function createUploadService({ database, client, now = Date.now }) {
  // One event to Supabase: 'sent', 'next' (blocked or skipped: go on),
  // 'refused' (403: go on, without this receiver), 'retry' (network/server:
  // stop the pass), 'unauthorized' (401) or 'cancelled'.
  async function send(row, owner, phone, alive, signal) {
    let body;
    try { body = bleUploadPayload(row, phone); }
    catch (error) { await database.failed(row, error.message, true, now()); return 'next'; }
    // Recheck the login before each event, including after a mode change.
    const { data, error: sessionError } = await sessionUntilCancelled(client.auth, signal);
    if (sessionError) return 'retry';
    if (data.session?.user.id !== owner || !alive() || signal?.aborted) return 'cancelled';
    try {
      const result = await client.functions.invoke('ingest-phone-telemetry', { body, timeout: 15000, signal,
        headers: { Authorization: `Bearer ${data.session.access_token}` } });
      // A cancelled request may have reached the server; keep its UUID for retry.
      if (!alive() || signal?.aborted) return 'cancelled';
      if (result.error) {
        const status = result.error.context?.status;
        // 401: the sign-in was refused (判定表「使用中登入失效」). The row is
        // fine: it is not charged an attempt or a backoff.
        if (status === 401) return 'unauthorized';
        const message = t("c607", { value: status ? ` (${status})` : '', message: result.error.message });
        await database.failed(row, message, [400, 403, 409, 413, 422].includes(status), now());
        // 403: this phone is not (or no longer) the receiver's route, or the
        // account lost the Master: stop queueing it rather than block every packet.
        if (status === 403) { await database.refuse(row, message, now()); return 'refused'; }
        if (!status || status >= 500 || status === 429) return 'retry';
        return 'next';
      }
      if (result.data?.ok === true && result.data.event_id === row.event_id) {
        await database.sent(row);
        if (signal) logger.info(`[BLE relay background] Master ${row.master_id}: upload acknowledged`);
        return 'sent';
      }
      await database.failed(row, t("c608"), false, now());
      return 'retry';
    } catch (error) {
      if (!alive() || signal?.aborted) return 'cancelled';
      await database.failed(row, error.message || t("c609"), false, now());
      return 'retry';
    }
  }
  /**
   * Sends `rows` in order, PASS_REQUESTS at a time. Stops starting new ones
   * at the first stop outcome or when `more()` says no; requests already
   * out finish. With `skipRefused`, a receiver refused during the pass is
   * not tried again (its rows wait). → the stop outcome, or null.
   */
  async function sendAll(rows, owner, phone, alive, signal, { more = () => true, skipRefused = true } = {}) {
    let next = 0, stop = null;
    const refused = new Set();
    async function worker() {
      while (!stop && next < rows.length && more()) {
        const row = rows[next++];
        if (!alive() || signal?.aborted) { stop = stop || 'cancelled'; return; }
        // Another request of this pass was refused for the same receiver.
        if (skipRefused && refused.has(row.master_id)) continue;
        // A flush or another pass may have sent this already-fetched row.
        if (!await database.isPending(row)) continue;
        if (!alive() || signal?.aborted) { stop = stop || 'cancelled'; return; }
        const outcome = await send(row, owner, phone, alive, signal);
        if (outcome === 'refused') refused.add(row.master_id);
        if (STOPS.includes(outcome) && (!stop || STOPS.indexOf(outcome) < STOPS.indexOf(stop))) stop = outcome;
      }
    }
    await Promise.all(Array.from({ length: Math.min(PASS_REQUESTS, rows.length) }, worker));
    return stop;
  }
  return {
    async run(owner, alive = () => true, { signal } = {}) {
      if (uploading || !owner || !alive() || signal?.aborted) return 'cancelled';
      uploading = true;
      try {
        const phone = await database.identity();
        if (!phone) throw new Error(t("c606"));
        await database.prune?.(now());
        const started = now();
        const pending = await database.pending(owner, now(), PASS_ROWS);
        const stop = await sendAll(pending, owner, phone, alive, signal, { more: () => now() - started < PASS_BUDGET_MS });
        if (stop) return stop;
        return pending.length ? 'success' : 'idle';
      } finally { uploading = false; }
    },
    /**
     * Before a receiver's upload route changes (S3 切換上傳方式): send every
     * row of that Master still waiting in this phone, whatever its route and
     * retry time — nothing is deleted. Waits for a running pass first.
     * → { result: 'done' | 'offline' | 'unauthorized' | 'cancelled', remaining }.
     */
    async flush(owner, master, alive = () => true) {
      for (let waited = 0; uploading; waited += 200) {
        if (waited >= 30000 || !alive()) return { result: 'cancelled', remaining: await database.pendingCount(owner, master) };
        await pause(200);
      }
      uploading = true;
      try {
        const phone = await database.identity();
        if (!phone) throw new Error(t("c606"));
        const tried = new Set();
        for (;;) {
          if (!alive()) return { result: 'cancelled', remaining: await database.pendingCount(owner, master) };
          const rows = (await database.pendingFor(owner, master)).filter(row => !tried.has(row.event_id));
          if (!rows.length) break;
          for (const row of rows) tried.add(row.event_id);
          // Everything of this Master is tried, as before a route change.
          const stop = await sendAll(rows, owner, phone, alive, undefined, { skipRefused: false });
          if (stop === 'retry') return { result: 'offline', remaining: await database.pendingCount(owner, master) };
          if (stop) return { result: stop, remaining: await database.pendingCount(owner, master) };
        }
        return { result: 'done', remaining: await database.pendingCount(owner, master) };
      } finally { uploading = false; }
    },
  };
}
