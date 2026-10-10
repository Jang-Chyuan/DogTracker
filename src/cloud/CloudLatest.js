import { t } from '../i18n';
import { cloudError } from './CloudErrors';
import { mapCloudTelemetry } from './CloudTelemetry';
import { validCloudFix } from './CloudLatestSnapshot';
import { HOLD_LOOKBACK_MS } from '../placement/HoldStore';

const FIELDS = 'event_id,master_id,slave_id,seq,received_at,payload,rssi,snr,upload_source,phone_received_at';
const FALLBACK = 'upload_source.neq.phone,upload_source.is.null,phone_received_at.is.null';
const NONZERO = 'payload->lat.neq.0,payload->lon.neq.0';
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
export async function downloadCloudLatest({ client, masterIds, cutoff, signal, check = () => {} }) {
  if (!Number.isFinite(cutoff) || !Array.isArray(masterIds) || !masterIds.every(Number.isSafeInteger)) throw new Error(t('c588'));
  const masters = [...new Set(masterIds)];
  const dogs = [];
  if (!masters.length) return { cutoff, dogs };
  const read = async query => {
    await check();
    if (signal?.aborted) throw new Error(t('c576'));
    const { data, error, status } = await query.abortSignal(signal);
    await check();
    if (signal?.aborted) throw new Error(t('c576'));
    if (error) throw cloudError(t('c577', { value: '' }), error, status);
    if (!Array.isArray(data) || data.length > 1) throw new Error(t('c578'));
    return data[0] || null;
  };
  const base = fields => client.from('dog_telemetry').select(fields).in('master_id', masters)
    .lt('received_at', new Date(cutoff).toISOString());
  let after = null;
  for (;;) {
    let keys = base('slave_id').order('slave_id', { ascending: true }).limit(1);
    if (after !== null) keys = keys.gt('slave_id', after);
    const key = await read(keys);
    if (!key) break;
    const slave = key.slave_id;
    if (!Number.isInteger(slave) || (after !== null && slave <= after)) throw new Error(t('c579'));
    const latest = async fixed => {
      const candidates = [];
      for (const phone of [false, true]) {
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
        const row = await read(query);
        if (row) {
          const mapped = mapCloudTelemetry(row);
          if (mapped.slave_id !== slave || !masters.includes(mapped.master_id) || mapped.received_at >= cutoff
            || (phone && (row.upload_source !== 'phone' || !Number.isFinite(Date.parse(row.phone_received_at))))
            || (fixed && !validCloudFix(mapped))) throw new Error(t('c588'));
          candidates.push({ row, mapped });
        }
      }
      candidates.sort((a, b) => compare(b.row, a.row));
      return candidates[0]?.mapped || null;
    };
    const packet = await latest(false);
    if (!packet) throw new Error(t('c579'));
    const fixed = validCloudFix(packet) ? packet : await latest(true);
    // A latest packet with a fix is necessarily the latest valid fix. Without
    // GPS, query the independent valid-fix streams, including silent old dogs.
    dogs.push({ slaveId: slave, packet, fix: fixed });
    after = slave;
  }
  return { cutoff, dogs };
}

// This second stage never reads the archive. A silent dog's own last half hour
// is replayed, with the same bounded 40 good-fix candidates per clock stream
// used by the local hold reader. Partial context is never published.
export async function downloadCloudLatestContext({ client, masterIds, snapshot, signal, check = () => {} }) {
  const { cutoff, dogs } = snapshot;
  const result = [];
  let stored = 0;
  const read = async query => {
    await check();
    if (signal?.aborted) throw new Error(t('c576'));
    const { data, error, status } = await query.abortSignal(signal);
    await check();
    if (signal?.aborted) throw new Error(t('c576'));
    if (error) throw cloudError(t('c577', { value: '' }), error, status);
    if (!Array.isArray(data)) throw new Error(t('c578'));
    return data;
  };
  for (const dog of dogs) {
    const until = dog.packet.track_at + 1;
    const from = Math.min(cutoff, until) - HOLD_LOOKBACK_MS;
    const events = new Map(), seeds = new Map();
    for (const phone of [false, true]) {
      const clock = phone ? 'phone_received_at' : 'received_at';
      const base = () => {
        let query = client.from('dog_telemetry').select(FIELDS).in('master_id', masterIds)
          .eq('slave_id', dog.slaveId).lt('received_at', new Date(cutoff).toISOString());
        if (phone) query = query.eq('upload_source', 'phone').not('phone_received_at', 'is', null);
        return query;
      };
      const validate = row => {
        const mapped = mapCloudTelemetry(row);
        if (mapped.slave_id !== dog.slaveId || !masterIds.includes(mapped.master_id) || mapped.received_at >= cutoff
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
        query = query.order('received_at', { ascending: true }).order('event_id', { ascending: true }).limit(500);
        const page = await read(query);
        if (page.length > 500) throw new Error(t('c578'));
        if (!page.length) break;
        for (const row of page) {
          const mapped = validate(row);
          if (mapped.track_at < from || mapped.track_at >= until || (cursor && compare(row, cursor) <= 0)) throw new Error(t('c579'));
          if (!events.has(mapped.event_id)) stored++;
          if (stored > 20000) throw new Error(t('c578'));
          events.set(mapped.event_id, mapped);
          cursor = row;
        }
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
  }
  return { cutoff, dogs: result };
}
