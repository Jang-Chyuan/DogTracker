import { createClient } from 'npm:@supabase/supabase-js@2';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const integer = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;

Deno.serve(async req => {
  if (req.method !== 'POST') return reply(405, { error: 'POST required' });
  const jwt = /^Bearer (.+)$/i.exec(req.headers.get('Authorization') || '')?.[1];
  if (!jwt) return reply(401, { error: 'Login required' });
  const url = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !secret || !anon) return reply(503, { error: 'Server configuration incomplete' });
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, secret, options);
  try {
    const { data: identity, error: identityError } = await admin.auth.getUser(jwt);
    if (identityError || !identity.user) return reply(401, { error: 'Invalid login' });
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { error: 'Missing body' });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); return reply(413, { error: 'Body too large' }); }
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { return reply(400, { error: 'Invalid JSON' }); }
    if (!body || !integer(body.slave_id, 255) || !integer(body.master_id, 65535)
      || typeof body.password !== 'string' || !body.password || body.password.length > 4096) {
      return reply(400, { error: 'Invalid unlock request' });
    }
    // Use the authenticated user's email, never an email supplied by the caller.
    if (!identity.user.email) return reply(403, { error: 'Email password account required' });
    const verifier = createClient(url, anon, options);
    const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({
      email: identity.user.email, password: body.password,
    });
    body.password = '';
    if (passwordError || verified.user?.id !== identity.user.id) {
      return reply(403, { error: 'Password verification failed' });
    }
    // Do not leave the temporary password verification session active.
    const { error: signOutError } = await verifier.auth.signOut({ scope: 'local' });
    if (signOutError) return reply(503, { error: 'Verification unavailable' });
    const { data: membership, error: memberError } = await admin.from('device_members').select('gateway_id')
      .eq('user_id', identity.user.id).eq('gateway_id', `master_${body.master_id}`).limit(1);
    if (memberError) return reply(503, { error: 'Membership unavailable' });
    if (!membership?.length) return reply(403, { error: 'Master access denied' });
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60000;
    const { error } = await admin.from('fixed_location_unlocks').upsert({
      token, user_id: identity.user.id, slave_id: body.slave_id, master_id: body.master_id,
      expires_at: new Date(expiresAt).toISOString(),
    }, { onConflict: 'user_id,slave_id' });
    if (error) return reply(503, { error: 'Unlock unavailable' });
    return reply(200, { token, expiresAt });
  } catch { return reply(503, { error: 'Service temporarily unavailable' }); }
});
