const rows = result => result.results || result.rows?._array || [];
export function createUploadDatabase(db) {
  return {
    async identity() {
      return rows(await db.executeAsync("SELECT value FROM ble_upload_meta WHERE key='phone_id'"))[0]?.value;
    },
    async owner(owner) {
      await db.executeAsync("INSERT OR REPLACE INTO ble_upload_meta(key,value) VALUES('owner',?)", [owner || '']);
    },
    async settings(owner) {
      return rows(await db.executeAsync('SELECT * FROM ble_upload_settings WHERE owner_user_id=? ORDER BY master_id', [owner]));
    },
    async setMode(owner, master, mode) {
      if (!owner || !Number.isInteger(master) || master < 1 || master > 65535 || !['wifi', 'phone'].includes(mode)) throw new Error('上傳設定無效');
      await db.executeAsync('INSERT OR REPLACE INTO ble_upload_settings(owner_user_id,master_id,mode) VALUES(?,?,?)', [owner, master, mode]);
    },
    async pending(owner, now) {
      return rows(await db.executeAsync(`SELECT q.* FROM ble_upload_queue q JOIN ble_upload_settings s
        ON s.owner_user_id=q.owner_user_id AND s.master_id=q.master_id
        WHERE q.owner_user_id=? AND s.mode='phone' AND q.status='pending' AND q.next_retry_at<=?
        ORDER BY q.id LIMIT 20`, [owner, now]));
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
      await db.executeAsync("UPDATE ble_upload_queue SET status='pending',next_retry_at=0 WHERE owner_user_id=? AND status='blocked'", [owner]);
    },
    async summary(owner) {
      const counts = rows(await db.executeAsync('SELECT status,COUNT(*) count FROM ble_upload_queue WHERE owner_user_id=? GROUP BY status', [owner]));
      const last = rows(await db.executeAsync('SELECT MAX(sent_at) time FROM ble_upload_queue WHERE owner_user_id=?', [owner]))[0]?.time;
      const error = rows(await db.executeAsync("SELECT last_error FROM ble_upload_queue WHERE owner_user_id=? AND last_error<>'' ORDER BY id DESC LIMIT 1", [owner]))[0]?.last_error;
      const queueError = rows(await db.executeAsync("SELECT value FROM ble_upload_meta WHERE key='queue_error'"))[0]?.value;
      return { counts, last, error: queueError || error || '' };
    },
  };
}
