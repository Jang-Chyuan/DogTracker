import { performance } from 'perf_hooks';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

test.each([500, 3716, 20000])('bounded prototype cost for %i synthetic rows', async count => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    const now = Date.now();
    const records = Array.from({ length: count }, (_, index) => ({
      event_id: `anonymous-${index}`, master_id: 7, slave_id: 6,
      received_at: now - count + index, track_at: now - count + index,
      track_time_version: 1, slave_lat: 24.9892, slave_lon: 121.3132,
      activity_valid: 0, battery_valid: 0,
    }));
    for (let start = 0; start < count; start += 1000) await database.savePage('anonymous', records.slice(start, start + 1000));
    const pages = async () => (await connection.executeAsync('PRAGMA page_count')).results[0].page_count;
    const pageSize = (await connection.executeAsync('PRAGMA page_size')).results[0].page_size;
    const before = await pages();
    const begin = performance.now(); await database.beginDownload('anonymous');
    const beginMs = performance.now() - begin;
    const publish = performance.now(); await database.publishDownload('anonymous');
    const publishMs = performance.now() - publish;
    const next = performance.now(); await database.beginDownload('anonymous');
    const nextBeginMs = performance.now() - next;
    const page = performance.now();
    await database.savePage('anonymous', records.slice(0, 20).map(record => ({ ...record,
      event_id: `${record.event_id}-new`, received_at: now + 1, track_at: now + 1 })));
    const pageMs = performance.now() - page;
    const cow = performance.now();
    await database.repairTrackTimes('anonymous', records.slice(0, 200).map(record => ({
      event_id: record.event_id, received_at: new Date(now + 2).toISOString(), upload_source: 'wifi',
    })), records.slice(0, 200).map(record => record.event_id));
    const repair200Ms = performance.now() - cow;
    const promoted = performance.now(); await database.publishDownload('anonymous');
    const deltaPublishMs = performance.now() - promoted;
    console.log(JSON.stringify({ count, beginMs, publishMs, nextBeginMs,
      pageMs, repair200Ms, deltaPublishMs, beforeBytes: before * pageSize, afterBytes: (await pages()) * pageSize }));
    expect((await database.latestBySlave('anonymous', 0)).length).toBe(1);
  } finally { connection.close(); }
});
