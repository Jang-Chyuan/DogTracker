import { createClient } from '@supabase/supabase-js';
import { createCloudSecureStorage } from '../src/cloud/CloudSecureStorage';

const KEY = 'project-auth-token', OTHER = 'other-project-auth-token';
const service = key => `com.dogtracker.supabase.${key}`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture() {
  const values = new Map([[service(KEY), 'old-session']]);
  const vault = {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
    getGenericPassword: jest.fn(async ({ service: name }) => values.has(name) ? { password: values.get(name) } : false),
    setGenericPassword: jest.fn(async (_, value, { service: name }) => { values.set(name, value); return { service: name }; }),
    resetGenericPassword: jest.fn(async ({ service: name }) => { values.delete(name); return true; }),
  };
  return { values, vault, storage: createCloudSecureStorage(vault) };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('concurrent session reads share one native read, then reuse its durable value without crossing storage keys', async () => {
  const { vault, storage } = fixture(), read = deferred();
  vault.getGenericPassword.mockReturnValueOnce(read.promise);
  const first = storage.getItem(KEY), second = storage.getItem(KEY);
  expect(second).toBe(first); expect(vault.getGenericPassword).toHaveBeenCalledTimes(1);
  read.resolve({ password: 'old-session' });
  expect(await Promise.all([first, second, storage.getItem(KEY)])).toEqual(['old-session', 'old-session', 'old-session']);
  expect(await storage.getItem(KEY)).toBe('old-session');
  expect(await storage.getItem(OTHER)).toBeNull(); expect(await storage.getItem(OTHER)).toBeNull();
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(2);
});

test('late native read before logout returns the durable removed value and cannot resurrect the cache', async () => {
  const { vault, storage } = fixture(), read = deferred();
  vault.getGenericPassword.mockReturnValueOnce(read.promise);
  const old = storage.getItem(KEY);
  await storage.removeItem(KEY);
  read.resolve({ password: 'old-session' });
  expect(await old).toBeNull(); expect(await storage.getItem(KEY)).toBeNull();
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(1);
});

test('late read across account replacement returns the replacement, with no old-session cache refill', async () => {
  const { vault, storage } = fixture(), read = deferred();
  vault.getGenericPassword.mockReturnValueOnce(read.promise);
  const old = storage.getItem(KEY);
  await storage.setItem(KEY, 'replacement-session');
  read.resolve({ password: 'old-session' });
  expect(await old).toBe('replacement-session'); expect(await storage.getItem(KEY)).toBe('replacement-session');
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(1);
});

test('reads during a pending write wait for durable success and never expose an optimistic session', async () => {
  const { vault, storage } = fixture(), write = deferred();
  expect(await storage.getItem(KEY)).toBe('old-session');
  vault.setGenericPassword.mockReturnValueOnce(write.promise);
  const saving = storage.setItem(KEY, 'new-session');
  let settled = false;
  const reading = storage.getItem(KEY).then(value => { settled = true; return value; });
  await settle(); expect(settled).toBe(false);
  write.resolve({ service: service(KEY) }); await saving;
  expect(await reading).toBe('new-session');
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(1);
});

test.each(['false', 'reject'])('failed write (%s) never caches its candidate and a waiting read gets the actual vault', async failure => {
  const { vault, storage } = fixture(), write = deferred();
  expect(await storage.getItem(KEY)).toBe('old-session');
  vault.setGenericPassword.mockReturnValueOnce(write.promise);
  const saving = storage.setItem(KEY, 'uncommitted-session');
  const failed = saving.catch(error => error);
  const reading = storage.getItem(KEY);
  if (failure === 'false') write.resolve(false); else write.reject(new Error('native write failed'));
  expect(await failed).toBeInstanceOf(Error);
  expect(await reading).toBe('old-session'); expect(await storage.getItem(KEY)).toBe('old-session');
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(2);
});

test('unconfirmed or rejected removal re-reads the vault instead of caching a false logout', async () => {
  const { vault, storage } = fixture();
  expect(await storage.getItem(KEY)).toBe('old-session');
  vault.resetGenericPassword.mockResolvedValueOnce(false);
  await storage.removeItem(KEY);
  expect(await storage.getItem(KEY)).toBe('old-session');
  vault.resetGenericPassword.mockRejectedValueOnce(new Error('native reset failed'));
  await expect(storage.removeItem(KEY)).rejects.toThrow('native reset failed');
  expect(await storage.getItem(KEY)).toBe('old-session');
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(3);
});

test('same-key replacement and logout writes run in invocation order; another key is independent', async () => {
  const { vault, storage, values } = fixture(), write = deferred();
  vault.setGenericPassword.mockImplementationOnce(async (_, value, { service: name }) => {
    await write.promise; values.set(name, value); return { service: name };
  });
  const saving = storage.setItem(KEY, 'new-session'), removing = storage.removeItem(KEY);
  const reading = storage.getItem(KEY);
  await settle(); expect(vault.resetGenericPassword).not.toHaveBeenCalled();
  await storage.setItem(OTHER, 'other-session');
  expect(await storage.getItem(OTHER)).toBe('other-session');
  write.resolve(); await Promise.all([saving, removing]);
  expect(await reading).toBeNull(); expect(values.has(service(KEY))).toBe(false);
  expect(await storage.getItem(KEY)).toBeNull();
});

test('a failed native read is not cached and the next read can recover', async () => {
  const { vault, storage } = fixture();
  vault.getGenericPassword.mockRejectedValueOnce(new Error('device unavailable'));
  await expect(storage.getItem(KEY)).rejects.toThrow('device unavailable');
  expect(await storage.getItem(KEY)).toBe('old-session');
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(2);
});

test('new adapter restores from secure storage, including a session removed after its previous runtime ended', async () => {
  const { vault, storage, values } = fixture();
  expect(await storage.getItem(KEY)).toBe('old-session');
  values.delete(service(KEY));
  expect(await createCloudSecureStorage(vault).getItem(KEY)).toBeNull();
  expect(vault.getGenericPassword).toHaveBeenCalledTimes(2);
});

test('real SDK repeated getSession uses one vault read; expiry refresh and signOut retain durable storage and auth events', async () => {
  const { vault, storage, values } = fixture();
  const key = 'sb-example-auth-token';
  const session = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'fictional-owner' } };
  values.clear(); values.set(service(key), JSON.stringify(session));
  const fetch = jest.fn(async () => responseForSDK({ ...session, access_token: 'replacement-access',
    refresh_token: 'replacement-refresh', expires_in: 3600 }));
  const client = createClient('https://example.supabase.co', 'fixture-public-key', { auth: {
    storage, autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
  }, global: { fetch } });
  const events = [];
  const subscription = client.auth.onAuthStateChange((event, next) => { events.push([event, next?.user.id]); }).data.subscription;
  try {
    expect((await client.auth.getSession()).data.session.user.id).toBe('fictional-owner');
    await Promise.all(Array.from({ length: 12 }, () => client.auth.getSession()));
    expect(vault.getGenericPassword.mock.calls.filter(([options]) => options.service === service(key))).toHaveLength(1);
    // SDK refresh expiry checks still run on each read; caching stores strings,
    // not a bypass around auth validation or refresh.
    await storage.setItem(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 1 }));
    expect((await client.auth.getSession()).data.session.access_token).toBe('replacement-access');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(values.get(service(key))).access_token).toBe('replacement-access');
    expect(events.some(([event]) => event === 'TOKEN_REFRESHED')).toBe(true);
    await client.auth.getSession();
    expect(vault.getGenericPassword.mock.calls.filter(([options]) => options.service === service(key))).toHaveLength(1);
    const { error } = await client.auth.signOut({ scope: 'local' });
    expect(error).toBeNull(); expect(values.has(service(key))).toBe(false);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(events.some(([event]) => event === 'SIGNED_OUT')).toBe(true);
  } finally { subscription.unsubscribe(); await client.auth.dispose(); }
});
function responseForSDK(body) {
  return { ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body) };
}
