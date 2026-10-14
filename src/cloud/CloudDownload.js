import { t } from '../i18n';
import { mapCloudTelemetry } from './CloudTelemetry';
import { cloudError } from './CloudErrors';

// Only a read-only REST response may be abandoned. Native writes below still
// drain before the cloud slot is released, even after foreground/owner changes.
async function readResponse(query, signal) {
  if (!signal) return query;
  if (signal.aborted) throw new Error(t('c576'));
  let cancel;
  const canceled = new Promise((_, reject) => {
    cancel = () => reject(new Error(t('c576')));
    signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([query, canceled]); }
  finally { signal.removeEventListener('abort', cancel); }
}

export async function downloadCloudHistory({ client, database, owner, startAt, endBefore,
  masterId = null, slaveId = null, signal, isCurrent = () => true, onProgress = () => {},
  checkpoint = false, initialCursor = null, maxPages = Infinity, checkCurrent = () => {}, phoneTrack = null }) {
  if (checkpoint && !Number.isInteger(masterId)) throw new Error(t("c575"));
  const check = async () => {
    if (signal?.aborted || !isCurrent()) throw new Error(t("c576"));
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
    // One dog's day, or the dogs shown together (the history's day only the
    // cloud holds, 054b/055b).
    if (Array.isArray(slaveId)) query = query.in('slave_id', slaveId);
    else if (slaveId !== null) query = query.eq('slave_id', slaveId);
    // Rows the history places by phone time (CloudTrackTime), within a window.
    if (phoneTrack) query = query.eq('upload_source', 'phone')
      .gte('phone_received_at', phoneTrack.startAt).lt('phone_received_at', phoneTrack.endBefore);
    if (cursor) {
      // Values were validated by mapCloudTelemetry; retain microsecond precision.
      query = query.or(`received_at.gt.${cursor.time},and(received_at.eq.${cursor.time},event_id.gt.${cursor.id})`);
    }
    const { data, error, status } = await readResponse(query.abortSignal(signal), signal);
    await check();
    if (error) throw cloudError(t("c577", { value: error.code ? ` (${error.code})` : '' }), error, status);
    if (!Array.isArray(data)) throw new Error(t("c578"));
    // Query to empty, not to page-size: this 1,000-row page has no margin
    // below the server's max-rows, and the end of window becomes a checkpoint
    // and completeness proof. Unlike CloudPaging's short-page stop, keep it.
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
      throw new Error(t("c579"));
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
    // The last saved row too: every row received before it is saved.
    onProgress(processed, last);
  }
  // A budget limit is not end-of-window: leave the last committed row cursor.
  return processed;
}
