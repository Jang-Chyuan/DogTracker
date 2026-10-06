import { shortAddress, describePlace, createAddressLookup, ADDRESS_CONFIG } from '../src/placement/AddressLookup';
import { nameHolds } from '../src/placement/HoldStore';

// Answers seen from the phone's geocoder on 2026-10-06.
const DOG_4 = { latitude: 25.04365, longitude: 121.2454 };
const nearDog4 = [{ line: '338台灣桃园市芦竹区大华里大竹北路630巷21號', latitude: 25.0436516, longitude: 121.2453716, district: '芦竹区' }];

test('addresses are shortened and written in traditional characters', () => {
  expect(shortAddress(nearDog4[0].line)).toBe('蘆竹區大竹北路630巷21號');
  expect(shortAddress('334台灣桃園市八德區瑞興里仁德路498號')).toBe('八德區仁德路498號');
  expect(shortAddress('3樓, No. 20號中正路武陵里桃園區桃園市台灣 330')).toContain('No. 20');
});

test('a near address reads "附近"; a far one says how far, or only the district', () => {
  expect(describePlace(DOG_4, nearDog4)).toBe('蘆竹區大竹北路630巷21號附近');
  const terminal = { latitude: 25.0797, longitude: 121.2342 };
  expect(describePlace(terminal, [{ line: '337台灣桃園市大園區埔心里航站南路9號', latitude: 25.0804, longitude: 121.2331 }]))
    .toBe('大園區航站南路9號附近（約 140 m）');
  expect(describePlace(terminal, [{ line: '337台灣桃園市大園區航站南路6號', latitude: 25.0670, longitude: 121.2228, district: '大園區' }]))
    .toBe('大園區（附近沒有地址）');
  expect(describePlace(terminal, [])).toBeNull();
});

test('lookups run one at a time, are cached, and name the holds', async () => {
  const native = { reverseGeocode: jest.fn(async () => JSON.stringify(nearDog4)) };
  const lookup = createAddressLookup({ native });
  const heard = jest.fn();
  lookup.subscribe(heard);
  expect(lookup.lookup(DOG_4)).toBeUndefined();
  expect(lookup.lookup(DOG_4)).toBeUndefined();
  await new Promise(resolve => setImmediate(resolve));
  expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
  expect(heard).toHaveBeenCalled();
  expect(nameHolds({ 4: { coordinate: DOG_4, reason: '室內' } }, lookup)[4].address).toBe('蘆竹區大竹北路630巷21號附近');
});

test('without the native geocoder nothing is named', () => {
  expect(createAddressLookup({ native: null }).lookup(DOG_4)).toBeNull();
});

test('no answer (offline) or a geocoder that never replies is asked again later', async () => {
  jest.useFakeTimers();
  try {
    const native = { reverseGeocode: jest.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(async () => '[]')
      .mockImplementation(async () => JSON.stringify(nearDog4)) };
    const lookup = createAddressLookup({ native });
    lookup.lookup(DOG_4);
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.timeoutMs);
    expect(lookup.lookup(DOG_4)).toBeNull();
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.retryAfterMs + 1);
    lookup.lookup(DOG_4);
    await jest.advanceTimersByTimeAsync(1);
    expect(lookup.lookup(DOG_4)).toBeNull();
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.retryAfterMs + 1);
    lookup.lookup(DOG_4);
    await jest.advanceTimersByTimeAsync(1);
    expect(lookup.lookup(DOG_4)).toBe('蘆竹區大竹北路630巷21號附近');
  } finally { jest.useRealTimers(); }
});
