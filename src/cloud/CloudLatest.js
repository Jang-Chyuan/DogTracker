import { t } from '../i18n';
import { cloudError } from './CloudErrors';
import { mapCloudTelemetry } from './CloudTelemetry';
import { isFinalCloudPage } from './CloudPaging';
import { validCloudFix } from './CloudLatestSnapshot';
import { HOLD_LOOKBACK_MS } from '../placement/HoldStore';
import { inheritCloudDiagnosticSignal, beginCloudLogicalDiagnostic } from '../diagnostics/CloudAttemptDiagnostics';
import { serverClock } from './ServerClock';

const FIELDS = 'event_id,master_id,slave_id,seq,received_at,payload,rssi,snr,upload_source,phone_received_at';
const FALLBACK = 'upload_source.neq.phone,upload_source.is.null,phone_received_at.is.null';
const NONZERO = 'payload->lat.neq.0,payload->lon.neq.0';
const CONTEXT_PAGE = 500;
// The live map's cloud roster: dogs with a row received in the last 14 days
// (server `received_at`, which also bounds late phone uploads). Without a
// bound every slave_id ever stored under the user's Masters (old collars, lent
// collars, test IDs) stayed on the roster for good, and each one costs 2-5
// requests every 30 s plus its half-hour context (audit F4). 14 days covers a
// collar left charging in the kennel over a long holiday (Lunar New Year with
// its weekends is about 9-10 days) or a two-week break between field
// rotations, while a collar unheard for longer is no longer part of the team
// in the field. Its rows stay in the local archive: the history still lists
// it on the days it has data (HistoryDatabase.historyDogs).
export const ROSTER_WINDOW_MS = 14 * 24 * 60 * 60000;
const stamp = text => {
  const time = Date.parse(text);
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(text)?.[1] || '';
  return [time, Number(fraction.padEnd(6, '0').slice(3))];
};
const effective = row => row.upload_source === 'phone' && Number.isFinite(Date.parse(row.phone_received_at))
  ? stamp(row.phone_received_at) : stamp(row.received_at);
const compareStamp = (left, right) => left[0] - right[0] || left[1] - right[1];
const compare = (left, right) => compareStamp(effective(left), effective(right))
  || compareStamp(stamp(left.received_at), stamp(right.received_at))
  || left.event_id.toLowerCase().localeCompare(right.event_id.toLowerCase());

// Existing REST schema only: every accessible dog is discovered through a
// next-key seek, not a membership slave list or one reverse telemetry page.
// Phone and fallback clocks are separate ordered streams. A late-uploaded old
// phone packet therefore cannot replace a newer Wi-Fi packet or valid fix.
//
// `cutoff` is this phone's clock; received_at is the server's. The query is
// cut at the same moment on the server's clock (`serverCutoff`, ServerClock),
// so a phone running behind does not leave out the newest Wi-Fi rows.
export async function downloadCloudLatest({ client, masterIds, cutoff, signal, check = () => {},
  serverOffset = serverClock.offset() }) {
  if (!Number.isFinite(cutoff) || !Array.isArray(masterIds) || !masterIds.every(Number.isSafeInteger)) throw new Error(t('c588'));
  const masters = [...new Set(masterIds)];
  const dogs = [];
  const serverCutoff = cutoff + (Number.isFinite(serverOffset) ? serverOffset : 0);
  // Said only when it differs (a healthy clock keeps the snapshot as it was).
  const cut = serverCutoff === cutoff ? { cutoff } : { cutoff, serverCutoff };
  if (!masters.length) return { ...cut, dogs };
  const work = new AbortController();
  inheritCloudDiagnosticSignal(signal, work.signal);
  let failed = false, failure, stop;
  const stopped = new Promise((resolve, reject) => { stop = reject; });
  stopped.catch(() => {});
  const fail = error => {
    if (!failed) { failed = true; failure = error; stop(error); }
    work.abort(); return failure;
  };
  const cancel = () => fail(new Error(t('c576')));
  signal?.addEventListener?.('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const guard = async () => {
    await Promise.race([check(), stopped]);
    if (failed) throw failure;
    if (signal?.aborted || work.signal.aborted) throw new Error(t('c576'));
  };
  const read = async (query, stage) => {
    await guard();
    // Race the shared cancellation fence as well: a transport that ignores
    // AbortSignal may finish late, but cannot stall failure of the snapshot.
    const done = beginCloudLogicalDiagnostic(work.signal, stage);
    let result;
    try { result = await Promise.race([query.abortSignal(work.signal), stopped]); }
    finally { done?.(); }
    const { data, error, status } = result;
    await guard();
    if (error) throw cloudError(t('c577', { value: '' }), error, status);
    if (!Array.isArray(data) || data.length > 1) throw new Error(t('c578'));
    return data[0] || null;
  };
  const base = fields => client.from('dog_telemetry').select(fields).in('master_id', masters)
    .lt('received_at', new Date(serverCutoff).toISOString());
  const readDog = async ({ slave, fallbackHint }) => {
    const latest = async fixed => {
      // Each dog has at most two clock requests; its fix phase still waits
      // for the packet pair. All jobs share the snapshot cancellation fence.
      try {
        const candidates = (await Promise.all([false, true].map(async phone => {
          // Discovery has the same received/event ordering as the fallback
          // packet stream. Only that predicate's top row can replace its GET;
          // phone packets and both valid-fix streams remain independent.
          let row = !fixed && !phone ? fallbackHint : null;
          if (row) await guard();
          else {
            let query = base(FIELDS).eq('slave_id', slave);
            if (phone) query = query.eq('upload_source', 'phone').not('phone_received_at', 'is', null);
            if (fixed) {
              // JSON number comparison does not cast malformed strings. These
              // bounds match mapCloudTelemetry's 1e6 wire-coordinate units.
              query = query.gte('payload->lat', -90000000).lte('payload->lat', 90000000)
                .gte('payload->lon', -180000000).lte('payload->lon', 180000000);
            }
            if (!phone) query = query.or(fixed ? `and(or(${FALLBACK}),or(${NONZERO}))` : FALLBACK);
            else if (fixed) query = query.or(NONZERO);
            if (phone) query = query.order('phone_received_at', { ascending: false });
            query = query.order('received_at', { ascending: false }).order('event_id', { ascending: false }).limit(1);
            row = await read(query, fixed ? 'fix' : 'packet');
          }
          if (row) {
            const mapped = mapCloudTelemetry(row);
            if (mapped.slave_id !== slave || !masters.includes(mapped.master_id) || mapped.received_at >= serverCutoff
              || (phone && (row.upload_source !== 'phone' || !Number.isFinite(Date.parse(row.phone_received_at))))
              || (fixed && !validCloudFix(mapped))) throw new Error(t('c588'));
            return { row, mapped };
          }
          return null;
        }))).filter(Boolean);
        candidates.sort((a, b) => compare(b.row, a.row));
        return candidates[0]?.mapped || null;
      } catch (error) {
        throw fail(error);
      }
    };
    const packet = await latest(false);
    if (!packet) throw new Error(t('c579'));
    const fixed = validCloudFix(packet) ? packet : await latest(true);
    // No GPS: retain the independent old valid fix, including silent dogs.
    return { slaveId: slave, packet, fix: fixed };
  };
  const jobs = [], active = new Set(), queued = [];
  const prefetch = 4;
  const dispatch = () => {
    // Discovery can seek ahead while the two workers await packets/fixes.
    // Queued keys do not issue dog requests; every actual read still guards
    // owner/cancellation, and a failed sibling prevents further dispatch.
    while (!failed && active.size < 2 && queued.length) {
      const dog = queued.shift();
      const job = readDog(dog).catch(error => { throw fail(error); });
      job.catch(() => {});
      active.add(job); jobs.push(job);
      const finished = () => { active.delete(job); dispatch(); };
      job.then(finished, finished);
    }
  };
  try {
    let after = null;
    for (;;) {
      // One serial cursor, with at most four discovered keys waiting for a
      // worker. Backpressure bounds prefetch; ROSTER_WINDOW_MS bounds the roster.
      while (queued.length >= prefetch) { await Promise.race([...active, stopped]); await guard(); }
      // Only key discovery is bounded: a dog on the roster still gets its
      // newest valid fix however old (`latest(true)` below), so a collar
      // that has had no GPS for days keeps its last known position.
      let keys = base(FIELDS).gte('received_at', new Date(cutoff - ROSTER_WINDOW_MS).toISOString())
        .order('slave_id', { ascending: true })
        .order('received_at', { ascending: false }).order('event_id', { ascending: false }).limit(1);
      if (after !== null) keys = keys.gt('slave_id', after);
      const key = await read(keys, 'keys');
      if (!key) break;
      const slave = key.slave_id;
      if (!Number.isInteger(slave) || (after !== null && slave <= after)) throw new Error(t('c579'));
      await guard();
      const fallbackHint = key.upload_source !== 'phone' || key.phone_received_at == null ? key : null;
      queued.push({ slave, fallbackHint }); dispatch();
      after = slave;
    }
    // Discovery finishing does not mean queued dogs have finished. Workers
    // drain every key before the complete snapshot can be returned.
    while (queued.length || active.size) { await Promise.race([...active, stopped]); await guard(); }
    // Promise.all preserves discovery order and never exposes partial dogs.
    const complete = await Promise.all(jobs);
    await guard();
    return { ...cut, dogs: complete };
  } catch (error) {
    throw fail(error);
  } finally {
    signal?.removeEventListener?.('abort', cancel);
  }
}

// This second stage never reads the archive. A silent dog's own last half hour
// is replayed, with the same bounded 40 good-fix candidates per clock stream
// used by the local hold reader. Partial context is never published.
// `progress` (optional) receives aggregate counts only, so a caller can report
// how far a timed-out or failed stage got: requests issued, dogs completed.
export async function downloadCloudLatestContext({ client, masterIds, snapshot, signal, check = () => {}, progress }) {
  const { cutoff, dogs } = snapshot;
  // The same snapshot's cut on the server's clock (downloadCloudLatest).
  const serverCutoff = Number.isFinite(snapshot.serverCutoff) ? snapshot.serverCutoff : cutoff;
  const result = [];
  let stored = 0;
  const read = async query => {
    await check();
    if (signal?.aborted) throw new Error(t('c576'));
    if (progress) progress.requests++;
    const { data, error, status } = await query.abortSignal(signal);
    await check();
    if (signal?.aborted) throw new Error(t('c576'));
    if (error) throw cloudError(t('c577', { value: '' }), error, status);
    if (!Array.isArray(data)) throw new Error(t('c578'));
    return data;
  };
  for (const dog of dogs) {
    const until = dog.packet.track_at + 1;
    const from = Math.min(serverCutoff, until) - HOLD_LOOKBACK_MS;
    const events = new Map(), seeds = new Map();
    for (const phone of [false, true]) {
      const clock = phone ? 'phone_received_at' : 'received_at';
      const base = () => {
        let query = client.from('dog_telemetry').select(FIELDS).in('master_id', masterIds)
          .eq('slave_id', dog.slaveId).lt('received_at', new Date(serverCutoff).toISOString());
        if (phone) query = query.eq('upload_source', 'phone').not('phone_received_at', 'is', null);
        return query;
      };
      const validate = row => {
        const mapped = mapCloudTelemetry(row);
        if (mapped.slave_id !== dog.slaveId || !masterIds.includes(mapped.master_id) || mapped.received_at >= serverCutoff
          || (phone && (row.upload_source !== 'phone' || !Number.isFinite(Date.parse(row.phone_received_at)))))
          throw new Error(t('c588'));
        return mapped;
      };
      let cursor = null;
      for (;;) {
        let query = base().gte(clock, new Date(from).toISOString()).lt(clock, new Date(until).toISOString());
        const seek = cursor ? phone
          ? `${clock}.gt.${cursor[clock]},and(${clock}.eq.${cursor[clock]},received_at.gt.${cursor.received_at}),and(${clock}.eq.${cursor[clock]},received_at.eq.${cursor.received_at},event_id.gt.${cursor.event_id})`
          : `received_at.gt.${cursor.received_at},and(received_at.eq.${cursor.received_at},event_id.gt.${cursor.event_id})` : null;
        if (!phone) query = query.or(seek ? `and(or(${FALLBACK}),or(${seek}))` : FALLBACK);
        else if (seek) query = query.or(seek);
        if (phone) query = query.order(clock, { ascending: true });
        query = query.order('received_at', { ascending: true }).order('event_id', { ascending: true }).limit(CONTEXT_PAGE);
        const page = await read(query);
        if (page.length > CONTEXT_PAGE) throw new Error(t('c578'));
        for (const row of page) {
          const mapped = validate(row);
          if (mapped.track_at < from || mapped.track_at >= until || (cursor && compare(row, cursor) <= 0)) throw new Error(t('c579'));
          if (!events.has(mapped.event_id)) stored++;
          if (stored > 20000) throw new Error(t('c578'));
          events.set(mapped.event_id, mapped);
          cursor = row;
        }
        // A short page ends the window (CloudPaging), saving one empty request
        // per clock stream; a full page still seeks the next one.
        if (isFinalCloudPage(page, CONTEXT_PAGE)) break;
      }
      let query = base().lt(clock, new Date(from).toISOString())
        .gte('payload->lat', -90000000).lte('payload->lat', 90000000)
        .gte('payload->lon', -180000000).lte('payload->lon', 180000000).gte('payload->satellites', 5);
      query = query.or(phone ? NONZERO : `and(or(${FALLBACK}),or(${NONZERO}))`);
      if (phone) query = query.order(clock, { ascending: false });
      const page = await read(query.order('received_at', { ascending: false }).order('event_id', { ascending: false }).limit(40));
      if (page.length > 40) throw new Error(t('c578'));
      for (const row of page) {
        const mapped = validate(row);
        if (!validCloudFix(mapped) || mapped.track_at >= from) throw new Error(t('c588'));
        if (!seeds.has(mapped.event_id)) stored++;
        if (stored > 20000) throw new Error(t('c578'));
        seeds.set(mapped.event_id, mapped);
      }
    }
    result.push({ ...dog, context: [...events.values()].sort((a, b) => a.track_at - b.track_at || a.received_at - b.received_at || a.event_id.localeCompare(b.event_id)),
      seeds: [...seeds.values()].sort((a, b) => a.track_at - b.track_at || a.received_at - b.received_at || a.event_id.localeCompare(b.event_id)) });
    if (progress) progress.completedDogs++;
  }
  return { cutoff, dogs: result };
}
