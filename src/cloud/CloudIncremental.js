import { downloadCloudHistory } from './CloudDownload';

const DAY = 86400000;
const OVERLAP = 300000;

export async function listCloudMasters(client, owner, signal, check) {
  const masters = new Set();
  for (let offset = 0; ; ) {
    await check();
    const { data, error } = await client.from('device_members').select('gateway_id,slave_id')
      .eq('user_id', owner).order('gateway_id').order('slave_id')
      .range(offset, offset + 499).abortSignal(signal);
    await check();
    if (error || !Array.isArray(data)) throw new Error('無法讀取 Master 清單，請確認連線及權限');
    if (!data.length) return [...masters];
    for (const row of data) {
      const match = /^master_(\d+)$/.exec(row.gateway_id);
      if (match && Number.isSafeInteger(Number(match[1]))) masters.add(Number(match[1]));
    }
    offset += data.length;
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
  if (!Number.isFinite(start)) throw new Error('同步進度無效');
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
