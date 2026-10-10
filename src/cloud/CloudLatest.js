import { t } from '../i18n';
import { cloudError } from './CloudErrors';
import { mapCloudTelemetry } from './CloudTelemetry';
import { validCloudFix } from './CloudLatestSnapshot';

const FIELDS = 'event_id,master_id,slave_id,seq,received_at,payload,rssi,snr,upload_source,phone_received_at';
const FALLBACK = 'upload_source.neq.phone,upload_source.is.null,phone_received_at.is.null';
const NONZERO = 'payload->lat.neq.0,payload->lon.neq.0';
const micros = text => {
  const time = Date.parse(text);
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(text)?.[1] || '';
  return time * 1000 + Number(fraction.padEnd(6, '0').slice(3));
};
const effective = row => row.upload_source === 'phone' && Number.isFinite(Date.parse(row.phone_received_at))
  ? micros(row.phone_received_at) : micros(row.received_at);
const compare = (left, right) => effective(left) - effective(right)
  || micros(left.received_at) - micros(right.received_at)
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
