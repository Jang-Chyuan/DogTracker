import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { TextDecoder } from 'util';
import { Buffer } from 'buffer';

// Execute the actual Edge Function handler with mocked Supabase services.
function backend({ user = { id: 'owner', email: 'owner@example.com' }, verifiedId = 'owner', passwordError = null,
  members = [{ gateway_id: 'master_7' }], memberError = null, grantError = null } = {}) {
  let handler;
  const query = { select: jest.fn(() => query), eq: jest.fn(() => query),
    limit: jest.fn(async () => ({ data: members, error: memberError })),
    upsert: jest.fn(async () => ({ error: grantError })) };
  const verifier = { auth: {
    signInWithPassword: jest.fn(async () => ({ data: { user: { id: verifiedId } }, error: passwordError })),
    signOut: jest.fn(async () => ({ error: null })),
  } };
  const admin = { auth: { getUser: jest.fn(async () => ({ data: { user }, error: null })) },
    from: jest.fn(() => query) };
  const createClient = jest.fn().mockReturnValueOnce(admin).mockReturnValueOnce(verifier);
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/unlock-fixed-location/index.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const globals = {
    exports: {}, require: () => ({ createClient }),
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-secret', SUPABASE_ANON_KEY: 'anon' })[key] },
    serve: callback => { handler = callback; } },
    Response: class { constructor(body, options) { this.body = body; this.status = options.status; } },
    crypto: { randomUUID: () => 'grant-token' }, TextDecoder, Uint8Array, Date,
  };
  vm.runInNewContext(compiled, globals);
  const request = async (body = { slave_id: 8, master_id: 7, password: 'secret' }, jwt = 'session') => {
    const bytes = new Uint8Array(Buffer.from(JSON.stringify(body)));
    let read = false;
    const result = await handler({ method: 'POST', headers: { get: () => jwt ? `Bearer ${jwt}` : null },
      body: { getReader: () => ({ read: async () => {
        if (read) return { done: true };
        read = true;
        return { done: false, value: bytes };
      }, cancel: async () => {} }) } });
    return { status: result.status, data: JSON.parse(result.body) };
  };
  return { request, query, admin, verifier };
}

test('backend derives account from JWT and grants only its selected dog and Master', async () => {
  const api = backend({});
  const result = await api.request({ slave_id: 8, master_id: 7, password: 'secret', email: 'attacker@example.com' });
  expect(result.status).toBe(200);
  expect(api.admin.auth.getUser).toHaveBeenCalledWith('session');
  expect(api.verifier.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret' });
  expect(api.verifier.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(api.query.upsert).toHaveBeenCalledWith(expect.objectContaining({
    token: 'grant-token', user_id: 'owner', slave_id: 8, master_id: 7,
  }), { onConflict: 'user_id,slave_id' });
  expect(result.data.expiresAt).toBeGreaterThan(Date.now());
  expect(JSON.stringify(result.data)).not.toContain('secret');
});

test.each([
  { user: null }, { passwordError: new Error('wrong password') },
  { verifiedId: 'other' }, { members: [] }, { memberError: new Error('network') },
])('backend denies invalid identity, password or membership: %j', async options => {
  const api = backend(options);
  expect((await api.request()).status).toBeGreaterThanOrEqual(400);
  expect(api.query.upsert).not.toHaveBeenCalled();
});

test('backend rejects missing login and malformed input before password verification', async () => {
  const api = backend({});
  expect((await api.request(undefined, null)).status).toBe(401);
  expect((await api.request({ slave_id: 0, master_id: 7, password: 'secret' })).status).toBe(400);
  expect(api.verifier.auth.signInWithPassword).not.toHaveBeenCalled();
});
