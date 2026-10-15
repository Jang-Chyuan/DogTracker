import { t } from '../i18n';
import { FUTURE_TOLERANCE_MS } from './ServerClock';
// Cloud reception remains the download cursor; this time is only for geometry.
// A relayed row keeps the uploading phone's time, unless that phone's clock
// runs ahead: a row cannot have been received more than FUTURE_TOLERANCE_MS
// after the server got it, so the server's time stands in (as on the live
// map, ServerClock.cloudRowOnPhoneClock). The raw phone time is still kept.
export function cloudTrackTime(row) {
  const phone = typeof row.phone_received_at === 'string' ? Date.parse(row.phone_received_at) : NaN;
  const server = typeof row.received_at === 'number' ? row.received_at : Date.parse(row.received_at);
  const relayed = row.upload_source === 'phone' && Number.isFinite(phone);
  return {
    upload_source: row.upload_source ?? null,
    phone_received_at: Number.isFinite(phone) ? phone : null,
    track_at: relayed && !(Number.isFinite(server) && phone > server + FUTURE_TOLERANCE_MS) ? phone : server,
  };
}

export async function repairCloudTrackTimes({ client, database, owner, signal, check, onChange }) {
  if (!database.pendingTrackTimes) return;
  const pending = await database.pendingTrackTimes(owner);
  check();
  if (!pending.length) return;
  const { data, error } = await client.from('dog_telemetry')
    .select('event_id,received_at,upload_source,phone_received_at')
    .in('event_id', pending.map(row => row.event_id)).abortSignal(signal);
  check();
  if (error || !Array.isArray(data)) throw new Error(t("c594"));
  await database.repairTrackTimes(owner, data, pending.map(row => row.event_id));
  check();
  onChange();
}
