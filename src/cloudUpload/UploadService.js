import { bleUploadPayload } from './BleUploadPayload';
// Foreground and Headless JS use separate service objects in the same runtime.
let uploading = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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
export function createUploadService({ database, client }) {
  // One event to Supabase: 'sent', 'next' (blocked or skipped: go on),
  // 'retry' (network/server: stop the pass), 'unauthorized' (401) or
  // 'cancelled'.
  async function send(row, owner, phone, alive, signal) {
    let body;
    try { body = bleUploadPayload(row, phone); }
    catch (error) { await database.failed(row, error.message, true, Date.now()); return 'next'; }
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
        await database.failed(row, `上傳失敗${status ? ` (${status})` : ''}：${result.error.message}`,
          [400, 403, 409, 413, 422].includes(status), Date.now());
        // 401: the sign-in was refused (判定表「使用中登入失效」).
        if (status === 401) return 'unauthorized';
        if (!status || status >= 500 || status === 429) return 'retry';
        return 'next';
      }
      if (result.data?.ok === true && result.data.event_id === row.event_id) {
        await database.sent(row);
        if (signal) console.info(`[BLE relay background] Master ${row.master_id}: upload acknowledged`);
        return 'sent';
      }
      await database.failed(row, '雲端回覆未確認事件，稍後重試', false, Date.now());
      return 'retry';
    } catch (error) {
      if (!alive() || signal?.aborted) return 'cancelled';
      await database.failed(row, error.message || '網路連線失敗', false, Date.now());
      return 'retry';
    }
  }
  return {
    async run(owner, alive = () => true, { signal } = {}) {
      if (uploading || !owner || !alive() || signal?.aborted) return 'cancelled';
      uploading = true;
      try {
        const phone = await database.identity();
        if (!phone) throw new Error('手機識別尚未建立');
        const pending = await database.pending(owner, Date.now());
        for (const row of pending) {
          if (!alive() || signal?.aborted) return 'cancelled';
          // Recheck the fixed route before each event, including after a mode change.
          const settings = await database.settings(owner);
          if (!alive() || signal?.aborted) return 'cancelled';
          if (!settings.some(s => s.master_id === row.master_id && s.mode === 'phone')) continue;
          // A disable/re-enable may have removed this already-fetched queue row.
          if (!await database.isPending(row)) continue;
          if (!alive() || signal?.aborted) return 'cancelled';
          const outcome = await send(row, owner, phone, alive, signal);
          if (outcome === 'cancelled' || outcome === 'retry' || outcome === 'unauthorized') return outcome;
        }
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
        if (!phone) throw new Error('手機識別尚未建立');
        const tried = new Set();
        for (;;) {
          if (!alive()) return { result: 'cancelled', remaining: await database.pendingCount(owner, master) };
          const rows = (await database.pendingFor(owner, master)).filter(row => !tried.has(row.event_id));
          if (!rows.length) break;
          for (const row of rows) {
            tried.add(row.event_id);
            const outcome = await send(row, owner, phone, alive, undefined);
            if (outcome === 'retry') return { result: 'offline', remaining: await database.pendingCount(owner, master) };
            if (outcome === 'unauthorized' || outcome === 'cancelled') {
              return { result: outcome, remaining: await database.pendingCount(owner, master) };
            }
          }
        }
        return { result: 'done', remaining: await database.pendingCount(owner, master) };
      } finally { uploading = false; }
    },
  };
}
