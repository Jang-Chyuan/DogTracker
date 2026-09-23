import { createClient } from 'npm:@supabase/supabase-js@2';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const ranges: Record<string, [number, number]> = {
  lat: [-90000000, 90000000], lon: [-180000000, 180000000], speed: [0, 65535], satellites: [0, 255],
  hdop: [0, 65535], gpsTimestamp: [0, 4294967295], activityScore: [0, 65535], activityValid: [0, 255],
  activityTimestamp: [0, 4294967295], batteryMillivolts: [0, 65535], batteryPercentage: [0, 255], batteryValid: [0, 255], slaveId: [1, 255],
};

Deno.serve(async req => {
  if (req.method !== 'POST') return reply(405, { error: 'POST required' });
  const token = /^Bearer (.+)$/i.exec(req.headers.get('Authorization') || '')?.[1];
  if (!token) return reply(401, { error: 'Login required' });
  const url = Deno.env.get('SUPABASE_URL'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !secret) return reply(503, { error: 'Server configuration incomplete' });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { error: 'Invalid login' });
    // Bound bytes even when Content-Length is missing.
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { error: 'Missing body' });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) { await reader.cancel(); return reply(413, { error: 'Body too large' }); }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { return reply(400, { error: 'Invalid JSON' }); }
    if (!body || !uuid(body.event_id) || !uuid(body.phone_id) || !integer(body.master_id, 1, 65535)
      || !integer(body.slave_id, 1, 255) || !integer(body.seq, 0, 65535)
      || !body.payload || Object.entries(ranges).some(([k, [min, max]]) => !integer(body.payload[k], min, max))
      || body.payload.slaveId !== body.slave_id
      || !['rssi', 'snr'].every(k => typeof body[k] === 'number' && Number.isFinite(body[k]) && Math.abs(body[k]) <= 300)
      || typeof body.phone_received_at !== 'string' || !Number.isFinite(Date.parse(body.phone_received_at))
      || Date.parse(body.phone_received_at) > Date.now() + 300000)
      return reply(400, { error: 'Invalid telemetry' });
    const { data: route, error: routeError } = await admin.from('master_upload_routes').select('*').eq('master_id', body.master_id).maybeSingle();
    if (routeError) return reply(503, { error: 'Route configuration unavailable' });
    if (route?.mode !== 'phone' || route.owner_user_id !== auth.user.id || route.phone_id !== body.phone_id)
      return reply(403, { error: 'Phone not assigned to Master' });
    const { data: membership, error: memberError } = await admin.from('device_members').select('gateway_id')
      .eq('user_id', auth.user.id).eq('gateway_id', `master_${body.master_id}`).limit(1);
    if (memberError) return reply(503, { error: 'Membership lookup failed' });
    if (!membership?.length) return reply(403, { error: 'Master access denied' });
    const payload = Object.fromEntries(Object.keys(ranges).map(k => [k, body.payload[k]]));
    const record = { event_id: body.event_id, master_id: body.master_id, slave_id: body.slave_id,
      seq: body.seq, payload, rssi: body.rssi, snr: body.snr,
      upload_source: 'phone', uploaded_by: auth.user.id, phone_id: body.phone_id,
      phone_received_at: new Date(body.phone_received_at).toISOString() };
    const { error } = await admin.from('dog_telemetry').insert(record);
    if (error?.code === '23505') {
      // A lost HTTP response can safely retry. Never acknowledge another event's UUID.
      const { data: old, error: lookupError } = await admin.from('dog_telemetry').select('*').eq('event_id', body.event_id).single();
      if (lookupError) return reply(503, { error: 'Duplicate lookup failed' });
      const same = ['master_id', 'slave_id', 'seq', 'phone_id', 'uploaded_by', 'upload_source', 'rssi', 'snr'].every(k => old[k] === record[k as keyof typeof record])
        && Date.parse(old.phone_received_at) === Date.parse(record.phone_received_at)
        && Object.keys(ranges).every(k => old.payload[k] === payload[k]);
      return same ? reply(200, { ok: true, event_id: body.event_id }) : reply(409, { error: 'Event UUID conflict' });
    }
    if (error) return reply(error.code === '42501' ? 403 : 503, { error: 'Insert rejected' });
    return reply(200, { ok: true, event_id: body.event_id });
  } catch { return reply(503, { error: 'Service temporarily unavailable' }); }
});
