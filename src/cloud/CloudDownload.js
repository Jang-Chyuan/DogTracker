import { mapCloudTelemetry } from './CloudTelemetry';

export async function downloadCloudHistory({ client, database, owner, startAt, endBefore,
  masterId = null, signal, isCurrent = () => true, onProgress = () => {},
  checkpoint = false, initialCursor = null, maxPages = Infinity, checkCurrent = () => {} }) {
  if (checkpoint && !Number.isInteger(masterId)) throw new Error('自動同步需要 Master ID');
  const check = async () => {
    if (signal?.aborted || !isCurrent()) throw new Error('下載已取消');
    await checkCurrent();
  };
  let cursor = initialCursor;
  let processed = 0;
  for (let page = 0; page < maxPages; page += 1) {
    await check();
    let query = client.from('dog_telemetry')
      .select('event_id,master_id,slave_id,seq,received_at,payload,rssi,snr,upload_source,phone_received_at')
      .gte('received_at', startAt).lt('received_at', endBefore)
      .order('received_at', { ascending: true }).order('event_id', { ascending: true })
      .limit(1000);
    if (masterId !== null) query = query.eq('master_id', masterId);
    if (cursor) {
      // Values were validated by mapCloudTelemetry; retain microsecond precision.
      query = query.or(`received_at.gt.${cursor.time},and(received_at.eq.${cursor.time},event_id.gt.${cursor.id})`);
    }
    const { data, error } = await query.abortSignal(signal);
    await check();
    if (error) throw new Error(`下載失敗${error.code ? ` (${error.code})` : ''}，請確認連線、登入及讀取權限`);
    if (!Array.isArray(data)) throw new Error('雲端回傳格式不正確');
    // Query to empty, not to page-size: the server may impose a smaller limit.
    if (!data.length) {
      if (checkpoint) {
        await database.savePage(owner, [], { masterId, throughAt: endBefore, eventId: null });
        await check();
      }
      return processed;
    }
    const records = data.map(mapCloudTelemetry);
    const last = records[records.length - 1];
    if (cursor?.time === last.remote_received_at && cursor?.id === last.event_id) {
      throw new Error('雲端分頁未前進，已停止下載');
    }
    await check();
    if (checkpoint) {
      await database.savePage(owner, records, {
        masterId, throughAt: last.remote_received_at, eventId: last.event_id,
      });
    } else await database.savePage(owner, records);
    await check();
    cursor = { time: last.remote_received_at, id: last.event_id };
    processed += records.length;
    onProgress(processed);
  }
  // A budget limit is not end-of-window: leave the last committed row cursor.
  return processed;
}
