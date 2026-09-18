import { downloadCloudHistory } from './CloudDownload';

export const BUCKET = 60 * 60 * 1000;
export const WINDOW_HOURS = 24;

// Closed hours only. The hour that contains `now` still receives rows, so its
// count keeps changing and the incremental pass already covers it.
export function closedBuckets(now, hours = WINDOW_HOURS) {
  const current = Math.floor(now / BUCKET) * BUCKET;
  const buckets = [];
  for (let index = hours; index >= 1; index -= 1) buckets.push(current - index * BUCKET);
  return buckets;
}

// A row can appear in the cloud with a received_at older than the sync
// progress: a Master that buffers while offline uploads it later, and clocks
// differ between Master and phone. The incremental pass only looks back five
// minutes, so it cannot see those rows. Each closed hour is therefore compared
// by row count and re-scanned only when the cloud holds more rows than the
// count verified last time.
//
// The verified count comes from the cloud, never from local rows: retention
// trims the local copy, and comparing against a trimmed table would re-download
// the same hour on every sweep. A scan never moves the incremental checkpoint.
export async function reconcileCloudWindow({ client, database, owner, masterId,
  now = Date.now(), signal, isCurrent = () => true, hours = WINDOW_HOURS }) {
  const check = () => {
    if (signal?.aborted || !isCurrent()) throw new Error('核對已取消');
  };
  const buckets = closedBuckets(now, hours);
  if (!buckets.length) return 0;
  const saved = new Map((await database.loadBuckets(owner, masterId, buckets[0]) || [])
    .map(row => [Number(row.bucket_start), Number(row.cloud_count)]));
  check();
  // How far the incremental pass has already walked. An hour it covered was
  // fetched in full at that moment, so the first sweep records the current
  // count instead of downloading the hour again - otherwise a phone whose local
  // copy has been trimmed re-downloads a whole day the first time it sweeps.
  // Anything that lands in the hour afterwards still changes the count and is
  // picked up by the next sweep.
  const state = await database.loadSyncState(owner, masterId);
  const covered = Date.parse(state?.through_at);
  check();
  let repaired = 0;
  for (const start of buckets) {
    check();
    const end = start + BUCKET;
    const startAt = new Date(start).toISOString();
    const endBefore = new Date(end).toISOString();
    const { count, error } = await client.from('dog_telemetry')
      .select('event_id', { count: 'exact', head: true })
      .eq('master_id', masterId)
      .gte('received_at', startAt).lt('received_at', endBefore)
      .abortSignal(signal);
    check();
    if (error || !Number.isInteger(count)) {
      throw new Error('無法核對雲端筆數，將於下次核對重試');
    }
    if (saved.get(start) === count) continue;
    const walked = !saved.has(start) && Number.isFinite(covered) && covered >= end;
    // Only download when rows are actually missing; a trimmed hour is recorded
    // as verified so it is not fetched again on the next sweep.
    const local = walked ? count : await database.countRange(owner, masterId, start, end);
    check();
    if (local < count) {
      await downloadCloudHistory({ client, database, owner, masterId,
        startAt, endBefore, signal, isCurrent });
      check();
      repaired += 1;
    }
    await database.saveBucket(owner, masterId, start, count);
  }
  return repaired;
}
