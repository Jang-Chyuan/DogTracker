import { createAddressCache } from '../src/placement/AddressCache';
import { createAddressLookup } from '../src/placement/AddressLookup';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

const point = { latitude: 25, longitude: 121 };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('SQLite labels survive new service instances and nearby points share them', async () => {
  const connection = createMemoryConnection();
  try {
    const store = createAddressCache({ connection });
    const native = {
      reverseGeocode: jest.fn(async () =>
        JSON.stringify([{ ...point, line: '桃園市桃園區中正路1號' }]),
      ),
    };
    const first = createAddressLookup({ native, store });
    first.lookup(point);
    await flush();
    const second = createAddressLookup({
      native,
      store: createAddressCache({ connection }),
    });
    const nearby = { ...point, latitude: 25.0003 };
    await expect(second.lookupAddresses([nearby])).resolves.toEqual([
      '桃園區中正路 1 號附近',
    ]);
    expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
    expect(await store.find({ ...point, latitude: 25.001 })).toBeNull();
  } finally {
    connection.close();
  }
});

test('SQLite persists failed timestamps and prunes old entries without changing other tables', async () => {
  const connection = createMemoryConnection();
  try {
    const store = createAddressCache({ connection, limit: 2 });
    await store.save({ anchor: point, value: null, failedAt: 10 });
    expect(await store.find(point)).toMatchObject({
      value: null,
      failedAt: 10,
    });
    const native = { reverseGeocode: jest.fn(async () => '[]') };
    const service = createAddressLookup({ native, store, now: () => 20 });
    await expect(service.lookupAddresses([point])).resolves.toEqual([null]);
    expect(native.reverseGeocode).not.toHaveBeenCalled();
    await store.save({ anchor: { latitude: 26, longitude: 121 }, value: '二' });
    await store.save({ anchor: { latitude: 27, longitude: 121 }, value: '三' });
    expect(
      connection.sqlite.prepare('SELECT count(*) AS n FROM address_cache').get()
        .n,
    ).toBe(2);
  } finally {
    connection.close();
  }
});
