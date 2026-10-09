const rows = result => result.results || result.rows?._array || [];
export function createUploadDatabase(db) {
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
      if (!owner || !Number.isInteger(master) || master < 1 || master > 65535 || !['wifi', 'phone'].includes(mode)) throw new Error('上傳設定無效');
      // Nothing waiting is deleted (S3: 不刪任何資料); the page sends it
      // first (UploadService.flush).
      await db.executeAsync('INSERT OR REPLACE INTO ble_upload_settings(owner_user_id,master_id,mode) VALUES(?,?,?)',
        [owner, master, mode]);
    },
    async isPending(row) {
      return rows(await db.executeAsync(`SELECT 1 FROM ble_upload_queue
        WHERE owner_user_id=? AND event_id=? AND status='pending'`,
      [row.owner_user_id, row.event_id])).length > 0;
    },
    // What waits in this phone, each dog's newest first. The route only
    // decides what the receiver service queues; a row already queued here is
    // this phone's to send even after its receiver went back to Wi-Fi (S3:
    // nothing is deleted, nothing is left behind).
    async pending(owner, now) {
      return rows(await db.executeAsync(`WITH latest AS (
        SELECT MAX(id) id FROM ble_upload_queue WHERE owner_user_id=? AND status='pending'
        GROUP BY master_id, slave_id
      ) SELECT q.* FROM ble_upload_queue q
        LEFT JOIN latest l ON l.id=q.id
        WHERE q.owner_user_id=? AND q.status='pending' AND q.next_retry_at<=?
        ORDER BY CASE WHEN l.id IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN l.id IS NOT NULL THEN q.received_at END DESC,
          q.id LIMIT 20`, [owner, owner, now]));
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
      await db.executeBatchAsync([
        { query: "UPDATE ble_upload_queue SET status='sent',last_error='',sent_at=? WHERE event_id=? AND owner_user_id=?", params: [Date.now(), row.event_id, row.owner_user_id] },
        { query: "DELETE FROM ble_upload_queue WHERE status='sent' AND id NOT IN (SELECT id FROM ble_upload_queue WHERE status='sent' ORDER BY id DESC LIMIT 1000)", params: [] },
      ]);
    },
    async failed(row, message, blocked, now) {
      const delay = Math.min(3600000, 10000 * 2 ** Math.min(row.attempts, 9));
      await db.executeAsync('UPDATE ble_upload_queue SET status=?,attempts=attempts+1,next_retry_at=?,last_error=? WHERE event_id=? AND owner_user_id=?',
        [blocked ? 'blocked' : 'pending', now + delay, message.slice(0, 300), row.event_id, row.owner_user_id]);
    },
    async retry(owner) {
      // 「重試」: refused rows again, and waiting ones without their backoff.
      await db.executeAsync("UPDATE ble_upload_queue SET status='pending',next_retry_at=0 WHERE owner_user_id=? AND status IN ('blocked','pending')", [owner]);
    },
    async summary(owner) {
      const counts = rows(await db.executeAsync('SELECT status,COUNT(*) count FROM ble_upload_queue WHERE owner_user_id=? GROUP BY status', [owner]));
      const byMaster = rows(await db.executeAsync("SELECT master_id,COUNT(*) count FROM ble_upload_queue WHERE owner_user_id=? AND status='pending' GROUP BY master_id", [owner]));
      // 刪除全部狗資料 (S7) removes the sent rows but keeps their last time.
      const last = Number(rows(await db.executeAsync(`SELECT MAX(
        COALESCE((SELECT MAX(sent_at) FROM ble_upload_queue WHERE owner_user_id=?), 0),
        COALESCE((SELECT CAST(value AS INTEGER) FROM ble_upload_meta WHERE key='last_sent_at:' || ?), 0)) time`,
      [owner, owner]))[0]?.time) || null;
      const error = rows(await db.executeAsync("SELECT last_error FROM ble_upload_queue WHERE owner_user_id=? AND last_error<>'' ORDER BY id DESC LIMIT 1", [owner]))[0]?.last_error;
      const queueError = rows(await db.executeAsync("SELECT value FROM ble_upload_meta WHERE key='queue_error'"))[0]?.value;
      const pendingByMaster = Object.fromEntries(byMaster.map(row => [row.master_id, Number(row.count)]));
      return { counts, pendingByMaster, last, error: queueError || error || '' };
    },
  };
}
