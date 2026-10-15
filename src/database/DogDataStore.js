import { t } from '../i18n';
import { NativeModules } from 'react-native';
import { withCloudSyncSlot } from '../cloud/CloudSyncSlot';
import { withConnectionLock } from './connectionLock';
import { executeHistoryMaterialBatch } from '../cloud/HistoryMaterialPublication';
import { forgetAddresses } from '../placement/AddressLookup';
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
//   address_cache         the stays' resolved addresses (home too); the
//                         lookup's memory with it (forgetAddresses)
// Kept:
//   myLocationTracker (手機路線), dog_names, dog_avatars and
//   map_history_settings (names, faces, history choices), app_settings, ble_upload_settings and
//   ble_upload_meta (upload routes, this phone's upload ID; the last upload
//   time is kept there for S3), cloud_sync_state and cloud_sync_buckets
//   (how far the download got: without them the next sync would download
//   the last 24 hours again at once, refilling what was just deleted).

export const DOG_DATA_TABLES = Object.freeze(['dog_status', 'supabase_dog_status', 'receiver_range_state', 'history_download_state']);
// Pending pages and their completion proof are also dog data. Keep published
// sync cursors, but never let an abandoned pre-delete job resurrect positions.
const deletedTables = [...DOG_DATA_TABLES, 'address_cache',
  // Before latest gained its own file, these snapshots lived in the archive.
  // Upgrades keep the tables: clear their all-account positions/context too.
  'cloud_latest_snapshot', 'cloud_snapshot_state', 'cloud_download_jobs', 'cloud_archive_publication',
  ...['auto', 'manual'].flatMap(kind => ['supabase_dog_status', 'cloud_sync_state',
    'cloud_sync_buckets', 'history_download_state'].map(table => `cloud_${kind}_${table}`))];
export const UPLOAD_QUEUE = 'ble_upload_queue';
// Rows not in the cloud yet: waiting, or refused and waiting for 重試.
export const UNSENT = "status IN ('pending','blocked')";

const rows = result => result?.results || result?.rows?._array || [];

/** Raised when rows not uploaded yet would be deleted without 「一起刪除」. */
export class UnsentRowsError extends Error {
  constructor(count) {
    super(t("c614", { count: count }));
    this.count = count;
  }
}

export function createDogDataStore(connection, latestSnapshots = null) {
  // The upload queue is created by the Android receiver service; a phone
  // that never ran it (or another platform) has none.
  async function hasQueue() {
    return rows(await connection.executeAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [UPLOAD_QUEUE])).length > 0;
  }
  async function existing() {
    const names = new Set(rows(await connection.executeAsync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${deletedTables.map(() => '?').join(',')})`,
      deletedTables)).map(row => row.name));
    return deletedTables.filter(name => names.has(name));
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
    async deleteAll({ includeUnsent = false, beforeDelete = () => {} } = {}) {
      const queue = await hasQueue();
      const waiting = queue ? await unsent() : 0;
      if (waiting > 0 && !includeUnsent) throw new UnsentRowsError(waiting);
      const clearArchive = () => withConnectionLock(connection, async () => {
        // Discover schemas only after earlier archive work drained: that work
        // may have created a stage/proof table since the user pressed delete.
        const commands = (await existing()).map(table => ({ query: `DELETE FROM ${table}`, params: [] }));
        if (queue) {
          // S3 still says when this account last uploaded (UploadDatabase.summary).
          commands.push({ query: `INSERT OR REPLACE INTO ble_upload_meta(key,value)
            SELECT 'last_sent_at:' || owner_user_id, CAST(MAX(sent_at) AS TEXT) FROM ${UPLOAD_QUEUE}
            WHERE sent_at IS NOT NULL GROUP BY owner_user_id`, params: [] });
          // A row queued meanwhile stays unless 「一起刪除」 was chosen.
          commands.push({ query: includeUnsent ? `DELETE FROM ${UPLOAD_QUEUE}`
            : `DELETE FROM ${UPLOAD_QUEUE} WHERE NOT (${UNSENT})`, params: [] });
        }
        // Preserve and advance the actual durable material revision when rows
        // are removed; deleting/resetting that counter could certify stale UI.
        await executeHistoryMaterialBatch(connection, commands);
      });
      const fence = latestSnapshots?.clearLatestAndRun ? beforeDelete() : null;
      try {
        if (latestSnapshots?.clearLatestAndRun)
          await latestSnapshots.clearLatestAndRun(() => withCloudSyncSlot(clearArchive));
        else await clearArchive();
        await forgetAddresses();
        await NativeModules.HistoryExport?.clearExports?.();
      } catch (error) {
        fence?.failed?.();
        throw error;
      }
    },
  };
}
