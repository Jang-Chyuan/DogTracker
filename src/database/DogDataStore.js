// 設定 → 進階 → 刪除全部狗資料 (design S7; 判定表「刪除全部狗資料」): only this
// phone's dog position records and its downloaded copy. It does not touch
// the cloud, the phone's own route, the dogs' names and faces, or any
// setting; whatever the cloud holds can be downloaded again from history.
//
// Deleted (dogtracker.sqlite):
//   dog_status            positions this phone's receiver delivered (BLE)
//   supabase_dog_status   positions downloaded from Supabase
//   ble_upload_queue      positions this phone was to upload for a receiver:
//                         the sent ones always (already in the cloud); the
//                         ones not sent yet only with 「一起刪除」
// Kept:
//   myLocationTracker (手機路線), dog_avatars and map_history_settings (names,
//   faces, history choices), app_settings, ble_upload_settings and
//   ble_upload_meta (upload routes, this phone's upload ID; the last upload
//   time is kept there for S3), cloud_sync_state and cloud_sync_buckets
//   (how far the download got: without them the next sync would download
//   the last 24 hours again at once, refilling what was just deleted).

export const DOG_DATA_TABLES = Object.freeze(['dog_status', 'supabase_dog_status', 'receiver_range_state']);
export const UPLOAD_QUEUE = 'ble_upload_queue';
// Rows not in the cloud yet: waiting, or refused and waiting for 重試.
export const UNSENT = "status IN ('pending','blocked')";

const rows = result => result?.results || result?.rows?._array || [];

/** Raised when rows not uploaded yet would be deleted without 「一起刪除」. */
export class UnsentRowsError extends Error {
  constructor(count) {
    super(`還有 ${count} 筆沒上傳`);
    this.count = count;
  }
}

export function createDogDataStore(connection) {
  // The upload queue is created by the Android receiver service; a phone
  // that never ran it (or another platform) has none.
  async function hasQueue() {
    return rows(await connection.executeAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [UPLOAD_QUEUE])).length > 0;
  }
  async function existing() {
    const names = new Set(rows(await connection.executeAsync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${DOG_DATA_TABLES.map(() => '?').join(',')})`,
      DOG_DATA_TABLES)).map(row => row.name));
    return DOG_DATA_TABLES.filter(name => names.has(name));
  }
  async function unsent() {
    if (!await hasQueue()) return 0;
    return Number(rows(await connection.executeAsync(
      `SELECT COUNT(*) count FROM ${UPLOAD_QUEUE} WHERE ${UNSENT}`))[0]?.count || 0);
  }
  return {
    /** Rows this phone still has to upload, every account's. */
    unsent,
    /**
     * Deletes this phone's dog data in one transaction. Without
     * `includeUnsent`, rows not uploaded yet stay (and stop it with
     * UnsentRowsError when there are any now: 「先上傳／一起刪除」 first).
     */
    async deleteAll({ includeUnsent = false } = {}) {
      const queue = await hasQueue();
      const waiting = queue ? await unsent() : 0;
      if (waiting > 0 && !includeUnsent) throw new UnsentRowsError(waiting);
      const commands = (await existing()).map(table => ({ query: `DELETE FROM ${table}`, params: [] }));
      if (queue) {
        // S3 still says when this account last uploaded (UploadDatabase.summary).
        commands.push({ query: `INSERT OR REPLACE INTO ble_upload_meta(key,value)
          SELECT 'last_sent_at:' || owner_user_id, CAST(MAX(sent_at) AS TEXT) FROM ${UPLOAD_QUEUE}
          WHERE sent_at IS NOT NULL GROUP BY owner_user_id`, params: [] });
        // A row the receiver queues while this runs is not sent yet: it stays
        // unless 「一起刪除」 was chosen.
        commands.push({ query: includeUnsent ? `DELETE FROM ${UPLOAD_QUEUE}`
          : `DELETE FROM ${UPLOAD_QUEUE} WHERE NOT (${UNSENT})`, params: [] });
      }
      await connection.executeBatchAsync(commands);
    },
  };
}
