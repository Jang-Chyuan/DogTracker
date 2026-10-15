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

// Audit L5: the saved addresses name where the dogs and this phone stayed,
// home too, so 刪除我的路線, 刪除全部狗資料 and signing out forget them.
test('clear forgets every address in memory and on the phone, and drops answers still on their way', async () => {
  const connection = createMemoryConnection();
  try {
    const store = createAddressCache({ connection });
    let answer;
    const native = {
      reverseGeocode: jest.fn(async latitude =>
        latitude === 25
          ? JSON.stringify([{ ...point, line: '桃園市桃園區中正路1號' }])
          : new Promise(resolve => { answer = resolve; }),
      ),
    };
    const lookup = createAddressLookup({ native, store });
    const listener = jest.fn();
    lookup.subscribe(listener);
    lookup.lookup(point);
    await flush();
    expect(lookup.lookup(point)).toBe('桃園區中正路 1 號附近');
    // Another place is still being asked, and one waits behind nothing.
    const far = { latitude: 26, longitude: 121 };
    expect(lookup.lookup(far)).toBeUndefined();
    await flush();
    expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
    listener.mockClear();
    await lookup.clear();
    expect(connection.sqlite.prepare('SELECT count(*) AS n FROM address_cache').get().n).toBe(0);
    // Places on screen are told, and ask again.
    expect(listener).toHaveBeenCalled();
    // The answer asked before the deletion is neither kept nor saved.
    answer(JSON.stringify([{ ...far, line: '桃園市大園區大觀路2號' }]));
    await flush();
    expect(connection.sqlite.prepare('SELECT count(*) AS n FROM address_cache').get().n).toBe(0);
    // The first place is asked again rather than answered from memory.
    expect(lookup.lookup(point)).toBeUndefined();
    await flush();
    expect(native.reverseGeocode).toHaveBeenCalledTimes(3);
    expect(await createAddressCache({ connection }).find(point)).toMatchObject({ value: '桃園區中正路 1 號附近' });
  } finally {
    connection.close();
  }
});

test('clear on an empty phone and without a store does not fail', async () => {
  const connection = createMemoryConnection();
  try {
    await createAddressCache({ connection }).clear();
    expect(connection.sqlite.prepare('SELECT count(*) AS n FROM address_cache').get().n).toBe(0);
    await expect(createAddressLookup({ native: null }).clear()).resolves.toBeUndefined();
  } finally {
    connection.close();
  }
});
