import { readFixedLocation, saveFixedLocation, validateFixedLocation } from '../src/cloud/FixedLocations';

const value = { slave_id: 8, master_id: 7, name: ' 家中 ', latitude: '25.1', longitude: '121.2', enabled: true };
function client(user = 'owner', error = null) {
  const query = { select: jest.fn(() => query), eq: jest.fn(() => query),
    upsert: jest.fn(() => query), single: jest.fn(async () => ({ data: value, error })),
    maybeSingle: jest.fn(async () => ({ data: value, error })) };
  return { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
    from: jest.fn(() => query), query };
}
test.each(['', ' ', 'NaN', '91', '-91'])('rejects invalid latitude %s', latitude => {
  expect(() => validateFixedLocation({ ...value, latitude })).toThrow();
});
test('normalizes coordinates and trims name', () => {
  expect(validateFixedLocation(value)).toEqual({ ...value, name: '家中', latitude: 25.1, longitude: 121.2 });
});
test('upserts with the authenticated identity and global slave conflict key', async () => {
  const api = client();
  await saveFixedLocation(api, 'owner', value);
  expect(api.query.upsert).toHaveBeenCalledWith({ ...validateFixedLocation(value), updated_by: 'owner' }, { onConflict: 'slave_id' });
});
test.each([null, 'another-user'])('blocks missing or changed account %s before writing', async user => {
  const api = client(user);
  await expect(saveFixedLocation(api, 'owner', value)).rejects.toThrow();
  expect(api.from).not.toHaveBeenCalled();
});
test('propagates RLS/network failures', async () => {
  await expect(saveFixedLocation(client('owner', new Error('denied')), 'owner', value)).rejects.toThrow('denied');
});
test('reads the selected slave setting', async () => {
  const api = client();
  await readFixedLocation(api, 'owner', 8);
  expect(api.query.eq).toHaveBeenCalledWith('slave_id', 8);
});
