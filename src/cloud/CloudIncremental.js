import { t } from '../i18n';
import { downloadCloudHistory } from './CloudDownload';
import { cloudError } from './CloudErrors';

const DAY = 86400000;
const OVERLAP = 300000;

export async function listCloudMasters(client, owner, signal, check) {
  const masters = new Set();
  // The SDK awaits its auth token before fetch. AbortSignal cannot necessarily
  // stop that await (or an old transport that ignores cancellation). Fence the
  // logical membership pass too, so it can relinquish the cloud slot on logout,
  // background or its existing deadline without accepting late membership.
  let cancel;
  const canceled = new Promise((_, reject) => { cancel = () => reject(new Error(t('c576'))); });
  canceled.catch(() => {});
  signal?.addEventListener?.('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    for (let offset = 0; ; ) {
      await check();
      if (signal?.aborted) throw new Error(t('c576'));
      const { data, error, status } = await Promise.race([
        client.from('device_members').select('gateway_id,slave_id')
          .eq('user_id', owner).order('gateway_id').order('slave_id')
          .range(offset, offset + 499).abortSignal(signal), canceled,
      ]);
      await check();
      if (signal?.aborted) throw new Error(t('c576'));
      if (error || !Array.isArray(data)) throw cloudError(t("c581"), error, status);
      if (!data.length) return [...masters];
      for (const row of data) {
        const match = /^master_(\d+)$/.exec(row.gateway_id);
        if (match && Number.isSafeInteger(Number(match[1]))) masters.add(Number(match[1]));
      }
      offset += data.length;
    }
  } finally {
    signal?.removeEventListener?.('abort', cancel);
  }
}

export async function downloadMasterIncremental({ client, database, owner, masterId,
  cutoff, signal, check, maxPages = Infinity, onChange = () => {} }) {
  await check();
  const saved = await database.loadSyncState(owner, masterId);
  await check();
  // An unfinished page cursor must resume exactly, including microseconds.
  // Completed windows retain the five-minute overlap for late visibility.
  const cursor = saved?.event_id ? { time: saved.through_at, id: saved.event_id } : null;
  const start = saved ? Date.parse(saved.through_at) - (cursor ? 0 : OVERLAP) : cutoff - DAY;
  if (!Number.isFinite(start)) throw new Error(t("c580"));
  if (start >= cutoff) return 0;
  if (!saved) {
    await database.savePage(owner, [], { masterId, throughAt: new Date(start).toISOString() });
    await check();
  }
  return downloadCloudHistory({
    client, owner, masterId, checkpoint: true, initialCursor: cursor, maxPages,
    database: { savePage: async (...args) => {
      await check();
      await database.savePage(...args);
      onChange();
    } },
    startAt: cursor?.time || new Date(start).toISOString(), endBefore: new Date(cutoff).toISOString(),
    signal, checkCurrent: check,
  });
}
