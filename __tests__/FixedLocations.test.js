import { readFixedLocation, saveFixedLocation, unlockFixedLocation, validateFixedLocation } from '../src/cloud/FixedLocations';

const value = { slave_id: 8, master_id: 7, name: ' 家中 ', latitude: '25.1', longitude: '121.2', enabled: true };
const unlock = () => ({ token: 'grant-token', expiresAt: Date.now() + 300000 });
function client(user = 'owner', error = null) {
  const query = { select: jest.fn(() => query), eq: jest.fn(() => query),
    upsert: jest.fn(() => query), single: jest.fn(async () => ({ data: value, error })),
    maybeSingle: jest.fn(async () => ({ data: value, error })) };
  return { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
    from: jest.fn(() => query), query,
    rpc: jest.fn(async () => ({ data: value, error })),
    functions: { invoke: jest.fn(async () => ({ data: unlock(), error })) } };
}
test.each(['', ' ', 'NaN', '91', '-91'])('rejects invalid latitude %s', latitude => {
  expect(() => validateFixedLocation({ ...value, latitude })).toThrow();
});
test('normalizes coordinates and trims name', () => {
  expect(validateFixedLocation(value)).toEqual({ ...value, name: '家中', latitude: 25.1, longitude: 121.2 });
});
test('saves through the protected RPC with the password grant', async () => {
  const api = client();
  await saveFixedLocation(api, 'owner', value, unlock());
  expect(api.rpc).toHaveBeenCalledWith('save_unlocked_fixed_location', {
    p_token: 'grant-token', p_slave_id: 8, p_master_id: 7,
    p_name: '家中', p_latitude: 25.1, p_longitude: 121.2, p_enabled: true,
  });
  expect(api.from).not.toHaveBeenCalled();
});
test.each([null, 'another-user'])('blocks missing or changed account %s before writing', async user => {
  const api = client(user);
  await expect(saveFixedLocation(api, 'owner', value, unlock())).rejects.toThrow();
  expect(api.from).not.toHaveBeenCalled();
});
test('propagates RLS/network failures', async () => {
  await expect(saveFixedLocation(client('owner', new Error('denied')), 'owner', value, unlock())).rejects.toThrow('denied');
});

test.each([null, { token: 'expired', expiresAt: 0 }])('rejects absent or expired grant', async grant => {
  const api = client();
  await expect(saveFixedLocation(api, 'owner', value, grant)).rejects.toThrow('解鎖');
  expect(api.rpc).not.toHaveBeenCalled();
});

test('password unlock calls backend without replacing the current login', async () => {
  const api = client();
  await expect(unlockFixedLocation(api, 'owner', 8, 7, 'password')).resolves.toMatchObject({ token: 'grant-token' });
  expect(api.functions.invoke).toHaveBeenCalledWith('unlock-fixed-location', {
    body: { slave_id: 8, master_id: 7, password: 'password' },
  });
});

test('wrong password and account changes never unlock', async () => {
  await expect(unlockFixedLocation(client('owner', new Error('wrong')), 'owner', 8, 7, 'wrong')).rejects.toThrow('無法解鎖');
  const api = client('another-user');
  await expect(unlockFixedLocation(api, 'owner', 8, 7, 'password')).rejects.toThrow('登入');
  expect(api.functions.invoke).not.toHaveBeenCalled();
});
test('reads the selected slave setting', async () => {
  const api = client();
  await readFixedLocation(api, 'owner', 8);
  expect(api.query.eq).toHaveBeenCalledWith('slave_id', 8);
});
