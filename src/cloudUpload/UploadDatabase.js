import { t } from '../i18n';
const rows = result => result.results || result.rows?._array || [];
// Refused rows (blocked) are kept for 重試 this long, at most this many.
export const BLOCKED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const BLOCKED_KEEP_ROWS = 2000;
// What UsbPresent threw before 2026-10-21 (bleUploadPayload refused the row).
export const OLD_USB_ERROR = 'usbPresent must be boolean or 0/1';
// A Master whose cloud route refused this phone (BleUploadQueue.kt): its rows
// wait, and the receiver service queues nothing more for it.
const NOT_REFUSED = alias => `${alias}.master_id NOT IN (SELECT master_id FROM ble_upload_refusals WHERE owner_user_id=${alias}.owner_user_id)`;
export function createUploadDatabase(db) {
  // When this phone last uploaded for each receiver (最後上傳成功…（經手機）,
  // S2/S3). The queue's own sent rows are the freshest answer, but only the
  // newest 1,000 of them are kept and 刪除全部狗資料 removes them all, so the
  // per-Master times written in `sent` are read alongside them.
  async function lastSentByMaster(owner) {
    const latest = {};
    const keep = (master, time) => {
      if (!Number.isInteger(master) || !Number.isFinite(time) || time <= 0) return;
      if (!(latest[master] >= time)) latest[master] = time;
    };
    for (const row of rows(await db.executeAsync(`SELECT master_id, MAX(sent_at) time
      FROM ble_upload_queue WHERE owner_user_id=? AND sent_at IS NOT NULL GROUP BY master_id`, [owner]))) {
      keep(Number(row.master_id), Number(row.time));
    }
    // The account is part of the key, so it is matched here rather than with a
    // LIKE pattern an account id could carry wildcards into.
    const prefix = `last_sent_at:${owner}:`;
    for (const row of rows(await db.executeAsync(
      "SELECT key,value FROM ble_upload_meta WHERE key LIKE 'last_sent_at:%'"))) {
      if (!String(row.key).startsWith(prefix)) continue;
      keep(Number(String(row.key).slice(prefix.length)), Number(row.value));
    }
    return latest;
  }
  return {
    async identity() {
      return rows(await db.executeAsync("SELECT value FROM ble_upload_meta WHERE key='phone_id'"))[0]?.value;
    },
    async owner(owner) {
      // Publish the receiver's account. No receiver is set to upload through
      // this phone by default (design: 不再預設 Master 5); a saved choice of
      // either route stays on resume or re-login.
      await db.executeAsync("INSERT OR REPLACE INTO ble_upload_meta(key,value) VALUES('owner',?)", [owner || '']);
    },
    async settings(owner) {
      return rows(await db.executeAsync('SELECT * FROM ble_upload_settings WHERE owner_user_id=? ORDER BY master_id', [owner]));
    },
    async setMode(owner, master, mode) {
      if (!owner || !Number.isInteger(master) || master < 1 || master > 65535 || !['wifi', 'phone'].includes(mode)) throw new Error(t("c605"));
      // Nothing waiting is deleted (S3: 不刪任何資料); the page sends it
      // first (UploadService.flush).
      await db.executeBatchAsync([
        { query: 'INSERT OR REPLACE INTO ble_upload_settings(owner_user_id,master_id,mode) VALUES(?,?,?)', params: [owner, master, mode] },
        // Choosing the route again is the answer to a refusal: try again.
        { query: 'DELETE FROM ble_upload_refusals WHERE owner_user_id=? AND master_id=?', params: [owner, master] },
      ]);
    },
    async isPending(row) {
      return rows(await db.executeAsync(`SELECT 1 FROM ble_upload_queue
        WHERE owner_user_id=? AND event_id=? AND status='pending'`,
      [row.owner_user_id, row.event_id])).length > 0;
    },
    // What waits in this phone, each dog's newest first. The route only
    // decides what the receiver service queues; a row already queued here is
    // this phone's to send even after its receiver went back to Wi-Fi (S3:
    // nothing is deleted, nothing is left behind). A refused Master's rows
    // wait for 重試 (refusals).
    async pending(owner, now, limit = 20) {
      return rows(await db.executeAsync(`WITH latest AS (
        SELECT MAX(id) id FROM ble_upload_queue q WHERE owner_user_id=? AND status='pending' AND ${NOT_REFUSED('q')}
        GROUP BY master_id, slave_id
      ) SELECT q.* FROM ble_upload_queue q
        LEFT JOIN latest l ON l.id=q.id
        WHERE q.owner_user_id=? AND q.status='pending' AND q.next_retry_at<=? AND ${NOT_REFUSED('q')}
        ORDER BY CASE WHEN l.id IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN l.id IS NOT NULL THEN q.received_at END DESC,
          q.id LIMIT ?`, [owner, owner, now, limit]));
    },
    // Every row of one Master still waiting, oldest first, whatever its route
    // or retry time (UploadService.flush).
    async pendingFor(owner, master, limit = 50) {
      return rows(await db.executeAsync(`SELECT * FROM ble_upload_queue
        WHERE owner_user_id=? AND master_id=? AND status='pending' ORDER BY id LIMIT ?`, [owner, master, limit]));
    },
    // The receivers this account still has rows waiting for (先上傳, S7).
    async pendingMasters(owner) {
      return rows(await db.executeAsync(`SELECT DISTINCT master_id FROM ble_upload_queue
        WHERE owner_user_id=? AND status='pending' ORDER BY master_id`, [owner])).map(row => Number(row.master_id));
    },
    async pendingCount(owner, master) {
      return Number(rows(await db.executeAsync(
        "SELECT COUNT(*) count FROM ble_upload_queue WHERE owner_user_id=? AND master_id=? AND status='pending'",
        [owner, master]))[0]?.count || 0);
    },
    async sent(row) {
      const now = Date.now();
      await db.executeBatchAsync([
        { query: "UPDATE ble_upload_queue SET status='sent',last_error='',sent_at=? WHERE event_id=? AND owner_user_id=?", params: [now, row.event_id, row.owner_user_id] },
        // 最後上傳成功 belongs to the receiver (S2/S3, 070), so its time is kept
        // per Master in the meta table: it has to outlive both the trim of sent
        // rows below and 刪除全部狗資料 (S7, DogDataStore.deleteAll).
        { query: "INSERT OR REPLACE INTO ble_upload_meta(key,value) VALUES('last_sent_at:' || ? || ':' || ?, ?)",
          params: [row.owner_user_id, row.master_id, String(now)] },
        { query: "DELETE FROM ble_upload_queue WHERE status='sent' AND id NOT IN (SELECT id FROM ble_upload_queue WHERE status='sent' ORDER BY id DESC LIMIT 1000)", params: [] },
        // Accepted again: whatever refused this receiver no longer does.
        { query: 'DELETE FROM ble_upload_refusals WHERE owner_user_id=? AND master_id=?', params: [row.owner_user_id, row.master_id] },
      ]);
    },
    /**
     * The cloud refused this phone for the row's receiver (403: not this
     * phone's route, or no access to the Master): stop queueing and sending
     * for it until 重試, a route change or a successful send.
     */
    async refuse(row, message, now) {
      await db.executeAsync('INSERT OR REPLACE INTO ble_upload_refusals(owner_user_id,master_id,refused_at,message) VALUES(?,?,?,?)',
        [row.owner_user_id, row.master_id, now, message.slice(0, 300)]);
    },
    /**
     * Refused rows (blocked) older than BLOCKED_KEEP_MS, or beyond the newest
     * BLOCKED_KEEP_ROWS, go. Rows an older build refused only for a garbled
     * USB flag (OLD_USB_ERROR, 2026-10-21) wait again: they now go without it.
     */
    async prune(now) {
      await db.executeBatchAsync([
        { query: "UPDATE ble_upload_queue SET status='pending',next_retry_at=0 WHERE status='blocked' AND last_error=?", params: [OLD_USB_ERROR] },
        { query: "DELETE FROM ble_upload_queue WHERE status='blocked' AND received_at<?", params: [now - BLOCKED_KEEP_MS] },
        { query: `DELETE FROM ble_upload_queue WHERE status='blocked' AND id NOT IN (
          SELECT id FROM ble_upload_queue WHERE status='blocked' ORDER BY id DESC LIMIT ${BLOCKED_KEEP_ROWS})`, params: [] },
      ]);
    },
    async failed(row, message, blocked, now) {
      const delay = Math.min(3600000, 10000 * 2 ** Math.min(row.attempts, 9));
      await db.executeAsync('UPDATE ble_upload_queue SET status=?,attempts=attempts+1,next_retry_at=?,last_error=? WHERE event_id=? AND owner_user_id=?',
        [blocked ? 'blocked' : 'pending', now + delay, message.slice(0, 300), row.event_id, row.owner_user_id]);
    },
    async retry(owner) {
      // 「重試」: refused rows and receivers again, and waiting ones without their backoff.
      await db.executeBatchAsync([
        { query: "UPDATE ble_upload_queue SET status='pending',next_retry_at=0 WHERE owner_user_id=? AND status IN ('blocked','pending')", params: [owner] },
        { query: 'DELETE FROM ble_upload_refusals WHERE owner_user_id=?', params: [owner] },
      ]);
    },
    async summary(owner) {
      const counts = rows(await db.executeAsync('SELECT status,COUNT(*) count FROM ble_upload_queue WHERE owner_user_id=? GROUP BY status', [owner]));
      const byMaster = rows(await db.executeAsync("SELECT master_id,status,COUNT(*) count FROM ble_upload_queue WHERE owner_user_id=? AND status IN ('pending','blocked') GROUP BY master_id,status", [owner]));
      // 刪除全部狗資料 (S7) removes the sent rows but keeps their last time.
      const last = Number(rows(await db.executeAsync(`SELECT MAX(
        COALESCE((SELECT MAX(sent_at) FROM ble_upload_queue WHERE owner_user_id=?), 0),
        COALESCE((SELECT CAST(value AS INTEGER) FROM ble_upload_meta WHERE key='last_sent_at:' || ?), 0)) time`,
      [owner, owner]))[0]?.time) || null;
      const error = rows(await db.executeAsync("SELECT last_error FROM ble_upload_queue WHERE owner_user_id=? AND last_error<>'' ORDER BY id DESC LIMIT 1", [owner]))[0]?.last_error;
      const queueError = rows(await db.executeAsync("SELECT value FROM ble_upload_meta WHERE key='queue_error'"))[0]?.value;
      const thinnedAt = Number(rows(await db.executeAsync("SELECT value FROM ble_upload_meta WHERE key='queue_thinned_at'"))[0]?.value) || null;
      const refusedMasters = rows(await db.executeAsync(
        'SELECT master_id FROM ble_upload_refusals WHERE owner_user_id=? ORDER BY master_id', [owner])).map(row => Number(row.master_id));
      const byStatus = status => Object.fromEntries(byMaster.filter(row => row.status === status)
        .map(row => [row.master_id, Number(row.count)]));
      const pendingByMaster = byStatus('pending'), blockedByMaster = byStatus('blocked');
      const lastByMaster = await lastSentByMaster(owner);
      // The receiver service thinned the oldest waiting rows (the queue was
      // full): said while rows from before that are still waiting.
      const backlog = thinnedAt != null && rows(await db.executeAsync(`SELECT 1 FROM ble_upload_queue
        WHERE owner_user_id=? AND status='pending' AND received_at<? LIMIT 1`, [owner, thinnedAt])).length > 0;
      const thinned = backlog ? t('c1361') : '';
      const refused = refusedMasters.length ? t('c1360', { masters: refusedMasters.join('、') }) : '';
      return { counts, pendingByMaster, blockedByMaster, last: Math.max(last || 0, ...Object.values(lastByMaster)) || null,
        lastByMaster, refusedMasters, thinnedAt, error: refused || queueError || thinned || error || '' };
    },
  };
}
