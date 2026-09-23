// Cloud reception remains the download cursor; this time is only for geometry.
export function cloudTrackTime(row) {
  const phone = typeof row.phone_received_at === 'string' ? Date.parse(row.phone_received_at) : NaN;
  return {
    upload_source: row.upload_source ?? null,
    phone_received_at: Number.isFinite(phone) ? phone : null,
    track_at: row.upload_source === 'phone' && Number.isFinite(phone)
      ? phone : (typeof row.received_at === 'number' ? row.received_at : Date.parse(row.received_at)),
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
  if (error || !Array.isArray(data)) throw new Error('歷史時間補查失敗，稍後重試');
  await database.repairTrackTimes(owner, data, pending.map(row => row.event_id));
  check();
  onChange();
}
