import React from 'react';
import { act, create } from 'react-test-renderer';
import { distanceMeters } from '../src/placement/IndoorHold';
import {
  shortAddress,
  withoutExtraNumberMark,
  describePlace,
  createAddressLookup,
  ADDRESS_CONFIG,
  addressLookup,
  useAddress,
  AddressLookupContext,
  usePlaceNames,
} from '../src/placement/AddressLookup';

// Answers seen from the phone's geocoder on 2026-10-06.
const DOG_4 = { latitude: 25.04365, longitude: 121.2454 };
const nearDog4 = [
  {
    line: '338台灣桃园市芦竹区大华里大竹北路630巷21號',
    latitude: 25.0436516,
    longitude: 121.2453716,
    district: '芦竹区',
  },
];

test('addresses are shortened and written in traditional characters', () => {
  expect(shortAddress(nearDog4[0].line)).toBe('蘆竹區大竹北路 630 巷 21 號');
  expect(shortAddress('334台灣桃園市八德區瑞興里仁德路498號')).toBe(
    '八德區仁德路 498 號',
  );
  expect(
    shortAddress('3樓, No. 20號中正路武陵里桃園區桃園市台灣 330'),
  ).toContain('No. 20');
});

// 2026-10-13, invented addresses: a geocoder line with a 號 after the floor
// (or after 之N, or doubled) reads 「…十三樓附近」, never 「十三樓號附近」.
test.each([
  ['330台灣桃園市桃園區中正路100號十三樓號', '桃園區中正路 100 號十三樓'],
  ['330台灣桃園市桃園區民生路8號二樓號', '桃園區民生路 8 號二樓'],
  ['330台灣桃園市桃園區復興路20巷5號七樓號', '桃園區復興路 20 巷 5 號七樓'],
  ['330台灣桃園市桃園區莒光街7號3樓號', '桃園區莒光街 7 號 3 樓'],
  ['330台灣桃園市桃園區成功路21號之3號', '桃園區成功路 21 號之 3'],
  ['330台灣桃園市桃園區大興路32號號', '桃園區大興路 32 號'],
])('no extra 號: %s', (line, short) => {
  expect(shortAddress(line)).toBe(short);
  expect(describePlace(DOG_4, [{ line, ...DOG_4 }])).toBe(`${short}附近`);
});

test.each([
  ['330台灣桃園市桃園區中正路100號', '桃園區中正路 100 號'],
  ['330台灣桃園市桃園區成功路21之3號', '桃園區成功路 21 之 3 號'],
  ['330台灣桃園市桃園區民生路8號二樓', '桃園區民生路 8 號二樓'],
])('a proper house number keeps its 號: %s', (line, short) => {
  expect(shortAddress(line)).toBe(short);
});

test('labels saved before the fix read without the extra 號 (online and offline)', async () => {
  expect(withoutExtraNumberMark('桃園區中正路 100 號十三樓號附近')).toBe('桃園區中正路 100 號十三樓附近');
  expect(withoutExtraNumberMark('桃園區成功路 21 號之 3 號附近（約 120 m）')).toBe('桃園區成功路 21 號之 3附近（約 120 m）');
  expect(withoutExtraNumberMark('桃園區大興路 32 號附近')).toBe('桃園區大興路 32 號附近');
  expect(withoutExtraNumberMark(null)).toBeNull();
  const saved = { find: async () => ({ value: '桃園區民生路 8 號二樓號附近' }), save: async () => {} };
  const offline = createAddressLookup({ native: { reverseGeocode: jest.fn(), isOnline: jest.fn(async () => false) }, store: saved });
  await expect(offline.lookupAddresses([DOG_4])).resolves.toEqual(['桃園區民生路 8 號二樓附近']);
  const online = createAddressLookup({ native: { reverseGeocode: jest.fn() }, store: saved });
  online.lookup(DOG_4);
  await flush();
  expect(online.lookup(DOG_4)).toBe('桃園區民生路 8 號二樓附近');
});

test('a near address reads "附近"; a far one says how far, or only the district', () => {
  expect(describePlace(DOG_4, nearDog4)).toBe('蘆竹區大竹北路 630 巷 21 號附近');
  const terminal = { latitude: 25.0797, longitude: 121.2342 };
  expect(
    describePlace(terminal, [
      {
        line: '337台灣桃園市大園區埔心里航站南路9號',
        latitude: 25.0804,
        longitude: 121.2331,
      },
    ]),
  ).toBe('大園區航站南路 9 號附近（約 140 m）');
  expect(
    describePlace(terminal, [
      {
        line: '337台灣桃園市大園區航站南路6號',
        latitude: 25.067,
        longitude: 121.2228,
        district: '大園區',
      },
    ]),
  ).toBe('大園區（附近沒有地址）');
  expect(describePlace(terminal, [])).toBeNull();
});

test('one place is asked once and its address cached', async () => {
  const native = {
    reverseGeocode: jest.fn(async () => JSON.stringify(nearDog4)),
  };
  const lookup = createAddressLookup({ native });
  const heard = jest.fn();
  lookup.subscribe(heard);
  expect(lookup.lookup(DOG_4)).toBeUndefined();
  expect(lookup.lookup(DOG_4)).toBeUndefined();
  await new Promise(resolve => setImmediate(resolve));
  expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
  expect(heard).toHaveBeenCalled();
  expect(lookup.lookup(DOG_4)).toBe('蘆竹區大竹北路 630 巷 21 號附近');
});

test('without the native geocoder nothing is named', () => {
  expect(createAddressLookup({ native: null }).lookup(DOG_4)).toBeNull();
});

test('no answer (offline) or a geocoder that never replies is asked again later', async () => {
  jest.useFakeTimers();
  try {
    const native = {
      reverseGeocode: jest
        .fn()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockImplementationOnce(async () => '[]')
        .mockImplementation(async () => JSON.stringify(nearDog4)),
    };
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
    expect(lookup.lookup(DOG_4)).toBe('蘆竹區大竹北路 630 巷 21 號附近');
  } finally {
    jest.useRealTimers();
  }
});

const flush = () => new Promise(resolve => setImmediate(resolve));

test('same display coordinate keeps one nearest address despite overlapping cache entries and LRU touches', async () => {
  const point = metres => ({ latitude: 25 + metres / 111320, longitude: 121 });
  const native = {
    reverseGeocode: jest.fn(async (latitude, longitude) => JSON.stringify([
      { latitude, longitude, line: latitude === point(0).latitude
        ? '桃園市桃園區示例路1號' : '桃園市桃園區示例路20號' },
    ])),
    isOnline: jest.fn(async () => true),
  };
  const lookup = createAddressLookup({ native });
  lookup.lookup(point(0));
  await flush();
  lookup.lookup(point(60));
  await flush();
  // Both distinct cached places are within 50 m of the displayed stay/end.
  // Reading either place changes LRU order, but cannot change the best address.
  const shared = point(20);
  const expected = '桃園區示例路 1 號附近';
  expect(Array.from({ length: 4 }, () => lookup.lookup(shared))).toEqual(
    [expected, expected, expected, expected],
  );
  let names;
  let tree;
  function Probe() { names = usePlaceNames([shared, shared]); return null; }
  try {
    act(() => { tree = create(<AddressLookupContext.Provider value={lookup}>
      <Probe />
    </AddressLookupContext.Provider>); });
    expect(names).toEqual([
      { state: 'found', text: expected }, { state: 'found', text: expected },
    ]);
    // Exact original coordinates still keep their own labels for raw exports.
    await expect(lookup.lookupAddresses([point(60), shared, point(0)]))
      .resolves.toEqual(['桃園區示例路 20 號附近', expected, expected]);
    native.isOnline.mockResolvedValue(false);
    await expect(lookup.lookupAddresses([shared, point(60), shared]))
      .resolves.toEqual([expected, '桃園區示例路 20 號附近', expected]);
    expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
  } finally { act(() => tree?.unmount()); }
});

test('closest result wins; district without a street and absent coordinates are safe', () => {
  expect(describePlace(DOG_4, [{ district: '大园区' }])).toBe(
    '大園區（附近沒有地址）',
  );
  expect(describePlace(DOG_4, [{ line: 'unknown' }])).toBeNull();
  expect(
    describePlace(DOG_4, [
      { line: 'far', latitude: 26, longitude: 121 },
      ...nearDog4,
    ]),
  ).toBe('蘆竹區大竹北路 630 巷 21 號附近');
  expect(shortAddress(' 338 臺灣桃園市蘆竹區大華村長興路國慶巷 ')).toBe(
    '蘆竹區長興路國慶巷',
  );
  expect(shortAddress('')).toBeNull();
});

test('invalid points never reach native; movement within 50 m reuses the anchored label', async () => {
  const native = {
    reverseGeocode: jest.fn(async () => JSON.stringify(nearDog4)),
  };
  const lookup = createAddressLookup({ native });
  for (const point of [
    null,
    {},
    { latitude: NaN, longitude: 121 },
    { latitude: 91, longitude: 121 },
  ])
    expect(lookup.lookup(point)).toBeNull();
  lookup.lookup(DOG_4);
  await flush();
  expect(lookup.lookup({ ...DOG_4, latitude: DOG_4.latitude + 0.0004 })).toBe(
    '蘆竹區大竹北路 630 巷 21 號附近',
  );
  expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
  lookup.lookup({ ...DOG_4, latitude: DOG_4.latitude + 0.001 });
  await flush();
  expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
});

test('with one at a time the queue serializes distinct points; export preserves order and duplicate points', async () => {
  let finish;
  const native = {
    reverseGeocode: jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      )
      .mockResolvedValue('[]'),
  };
  const lookup = createAddressLookup({ native, config: { ...ADDRESS_CONFIG, parallel: 1 } });
  const far = { latitude: 24, longitude: 120 };
  const exported = lookup.lookupAddresses([DOG_4, far, DOG_4]);
  await flush();
  expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
  finish(JSON.stringify(nearDog4));
  await expect(exported).resolves.toEqual([
    '蘆竹區大竹北路 630 巷 21 號附近',
    null,
    '蘆竹區大竹北路 630 巷 21 號附近',
  ]);
  expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
});

// 2026-10-14: one at a time, a busy day's 16 stays took 70 s on the emulator.
test('three places are asked at once; the fourth waits its turn (still pending)', async () => {
  const answers = [];
  const native = { reverseGeocode: jest.fn((latitude, longitude) => new Promise(resolve =>
    answers.push(() => resolve(JSON.stringify([{ latitude, longitude, line: '桃園市桃園區示範路1號' }]))))) };
  const lookup = createAddressLookup({ native });
  const places = [0, 1, 2, 3].map(index => ({ latitude: 25 + index * 0.01, longitude: 121 }));
  places.forEach(place => expect(lookup.lookup(place)).toBeUndefined());
  await flush();
  expect(native.reverseGeocode).toHaveBeenCalledTimes(3);
  answers[1]();
  await flush();
  expect(lookup.lookup(places[1])).toBe('桃園區示範路 1 號附近');
  expect(lookup.lookup(places[3])).toBeUndefined();
  expect(native.reverseGeocode).toHaveBeenCalledTimes(4);
});

test('a place that times out takes the places still waiting with it; asked again, a place stays null', async () => {
  jest.useFakeTimers();
  try {
    const native = { reverseGeocode: jest.fn(() => new Promise(() => {})) };
    const lookup = createAddressLookup({ native, config: { ...ADDRESS_CONFIG, parallel: 1 } });
    const OTHER = { latitude: 25.1, longitude: 121.3 };
    expect(lookup.lookup(DOG_4)).toBeUndefined();
    expect(lookup.lookup(OTHER)).toBeUndefined();
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.timeoutMs - 1);
    expect(lookup.lookup(OTHER)).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    // Only DOG_4 was asked; OTHER, still waiting, falls back at the same time.
    expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
    expect([lookup.lookup(DOG_4), lookup.lookup(OTHER)]).toEqual([null, null]);
    // A minute on it is asked again, and reads null (not 'still asking') meanwhile.
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.retryAfterMs);
    expect(lookup.lookup(DOG_4)).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
    expect(lookup.lookup(DOG_4)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('export waits past 5 s for places still being asked, and ends with a geocoder that never answers', async () => {
  jest.useFakeTimers();
  try {
    // A slow geocoder (8 s): the export still gets the address.
    let answer;
    const slow = createAddressLookup({ native: { reverseGeocode: jest.fn(() => new Promise(resolve => {
      answer = resolve;
    })) } });
    let done = null;
    slow.lookupAddresses([DOG_4]).then(result => { done = result; });
    await jest.advanceTimersByTimeAsync(8000);
    expect(done).toBeNull();
    answer(JSON.stringify(nearDog4));
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toEqual(['蘆竹區大竹北路 630 巷 21 號附近']);
    // Never answers: the place times out (15 s), the export ends with null.
    const native = { reverseGeocode: jest.fn(() => new Promise(() => {})) };
    const lookup = createAddressLookup({ native });
    const exported = lookup.lookupAddresses([DOG_4]);
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.timeoutMs);
    await expect(exported).resolves.toEqual([null]);
    // A connectivity check that never answers: at most exportWaitMs (20 s).
    const stuck = createAddressLookup({
      native: { ...native, isOnline: () => new Promise(() => {}) },
    });
    const pending = stuck.lookupAddresses([DOG_4]);
    await jest.advanceTimersByTimeAsync(ADDRESS_CONFIG.exportWaitMs);
    await expect(pending).resolves.toEqual([null]);
  } finally {
    jest.useRealTimers();
  }
});

test('export reads a place the list already named from the cache, and a recent miss without asking', async () => {
  const native = { reverseGeocode: jest.fn().mockResolvedValueOnce(JSON.stringify(nearDog4)).mockResolvedValue('[]') };
  const lookup = createAddressLookup({ native });
  const far = { latitude: 24, longitude: 120 };
  lookup.lookup(DOG_4);
  lookup.lookup(far);
  await flush();
  await flush();
  expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
  await expect(lookup.lookupAddresses([DOG_4, far])).resolves.toEqual(['蘆竹區大竹北路 630 巷 21 號附近', null]);
  expect(native.reverseGeocode).toHaveBeenCalledTimes(2);
});

test('offline export uses persistent labels immediately and never geocodes', async () => {
  const native = {
    reverseGeocode: jest.fn(),
    isOnline: jest.fn(async () => false),
  };
  const lookup = createAddressLookup({
    native,
    store: { find: async () => ({ value: '已存地址附近' }) },
  });
  await expect(lookup.lookupAddresses([DOG_4])).resolves.toEqual([
    '已存地址附近',
  ]);
  expect(native.reverseGeocode).not.toHaveBeenCalled();
});

test('cache read/write failures still allow a native answer; malformed answers retry', async () => {
  let time = 0;
  const native = {
    reverseGeocode: jest
      .fn()
      .mockResolvedValueOnce('bad JSON')
      .mockResolvedValue(JSON.stringify(nearDog4)),
  };
  const store = {
    find: jest.fn(async () => {
      throw new Error('storage');
    }),
    save: jest.fn(async () => {
      throw new Error('storage');
    }),
  };
  const lookup = createAddressLookup({ native, store, now: () => time });
  lookup.lookup(DOG_4);
  await flush();
  expect(lookup.lookup(DOG_4)).toBeNull();
  time = 60000;
  lookup.lookup(DOG_4);
  await flush();
  expect(lookup.lookup(DOG_4)).toBe('蘆竹區大竹北路 630 巷 21 號附近');
});

test('50 m and 300 m thresholds are inclusive; distant line yields district only', () => {
  const result = [{ ...DOG_4, line: '桃園市大園區航站路1號' }];
  expect(describePlace(DOG_4, result, { nearM: 0, tooFarM: 0 })).toBe(
    '大園區航站路 1 號附近',
  );
  const displaced = [{ ...result[0], latitude: DOG_4.latitude + 0.001 }];
  expect(describePlace(DOG_4, displaced, { nearM: 0, tooFarM: 300 })).toContain(
    '（約 110 m）',
  );
  expect(describePlace(DOG_4, displaced, { nearM: 0, tooFarM: 1 })).toBe(
    '大園區（附近沒有地址）',
  );
});

test('exact distance boundaries select near, approximate, then district labels', () => {
  const location = { ...DOG_4, latitude: DOG_4.latitude + 0.001 };
  const distance = distanceMeters(DOG_4, location);
  const result = [{ ...location, line: '桃園市大園區航站路1號' }];
  expect(
    describePlace(DOG_4, result, { nearM: distance, tooFarM: distance + 1 }),
  ).toBe('大園區航站路 1 號附近');
  expect(
    describePlace(DOG_4, result, { nearM: distance - 1, tooFarM: distance }),
  ).toContain('（約 110 m）');
  expect(
    describePlace(DOG_4, result, {
      nearM: distance - 2,
      tooFarM: distance - 1,
    }),
  ).toBe('大園區（附近沒有地址）');
});

test('hook keeps an original anchor within 50 m, changes beyond it and cleans up', () => {
  const lookup = jest
    .spyOn(addressLookup, 'lookup')
    .mockImplementation(point => (point ? `地址 ${point.latitude}` : null));
  const unsubscribe = jest.fn();
  let notify;
  const subscribe = jest
    .spyOn(addressLookup, 'subscribe')
    .mockImplementation(listener => {
      notify = listener;
      return unsubscribe;
    });
  let value;
  function Probe({ point }) {
    value = useAddress(point);
    return null;
  }
  let renderer;
  try {
    act(() => {
      renderer = create(<Probe point={null} />);
    });
    expect(value).toBeNull();
    act(() => renderer.update(<Probe point={DOG_4} />));
    expect(value).toBe(`地址 ${DOG_4.latitude}`);
    act(() =>
      renderer.update(
        <Probe point={{ ...DOG_4, latitude: DOG_4.latitude + 0.0003 }} />,
      ),
    );
    expect(value).toBe(`地址 ${DOG_4.latitude}`);
    act(() =>
      renderer.update(
        <Probe point={{ ...DOG_4, latitude: DOG_4.latitude + 0.001 }} />,
      ),
    );
    expect(value).toBe(`地址 ${DOG_4.latitude + 0.001}`);
    lookup.mockReturnValue(undefined);
    act(() => notify());
    expect(value).toBeNull();
    act(() => renderer.update(<Probe point={null} />));
    expect(value).toBeNull();
    act(() => renderer.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(4);
  } finally {
    lookup.mockRestore();
    subscribe.mockRestore();
  }
});

test('export retains resolved labels even when there are more points than cache slots', async () => {
  const native = {
    reverseGeocode: jest.fn(async (latitude, longitude) =>
      JSON.stringify([{ latitude, longitude, line: '桃園市桃園區中正路1號' }]),
    ),
  };
  const lookup = createAddressLookup({
    native,
    config: { ...ADDRESS_CONFIG, cacheSize: 1 },
  });
  const points = [
    DOG_4,
    { latitude: 24, longitude: 120 },
    { latitude: 23, longitude: 119 },
  ];
  await expect(lookup.lookupAddresses(points)).resolves.toEqual(
    points.map(() => '桃園區中正路 1 號附近'),
  );
  expect(native.reverseGeocode).toHaveBeenCalledTimes(3);
});

test('offline the geocoder is not asked; reopening the card asks again at once (retry)', async () => {
  let online = false;
  const native = {
    isOnline: jest.fn(async () => online),
    reverseGeocode: jest.fn(async () => JSON.stringify(nearDog4)),
  };
  const lookup = createAddressLookup({ native });
  expect(lookup.lookup(DOG_4)).toBeUndefined();
  await flush();
  await flush();
  expect(native.reverseGeocode).not.toHaveBeenCalled();
  expect(lookup.lookup(DOG_4)).toBeNull();
  online = true;
  // Within the minute a plain look keeps the miss; the card opening retries
  // (still null while it is asked again).
  expect(lookup.lookup(DOG_4)).toBeNull();
  expect(lookup.lookup(DOG_4, { retry: true })).toBeNull();
  await flush();
  await flush();
  expect(lookup.lookup(DOG_4)).toBe('蘆竹區大竹北路 630 巷 21 號附近');
});

test('a district-only answer is the district, not 「…附近」; a real address among them wins', () => {
  const at = { latitude: 25.0797, longitude: 121.2342 };
  expect(describePlace(at, [{ line: '337台灣桃園市大園區', ...at }])).toBe('大園區（附近沒有地址）');
  expect(describePlace(at, [{ line: '337台灣桃園市大園區', ...at },
    { line: '337台灣桃園市大園區航站南路9號', latitude: 25.0798, longitude: 121.2342 }])).toBe('大園區航站南路 9 號附近');
});

test('a saved miss is skipped when the card reopens; saved addresses never wait behind a slow geocoder', async () => {
  const saved = new Map();
  const store = {
    find: jest.fn(async point => saved.get(`${point.latitude}`) ?? null),
    save: jest.fn(async entry => { saved.set(`${entry.anchor.latitude}`, entry); }),
  };
  const OTHER = { latitude: 25.1, longitude: 121.3 };
  saved.set(`${DOG_4.latitude}`, { anchor: DOG_4, value: null, failedAt: Date.now() });
  saved.set(`${OTHER.latitude}`, { anchor: OTHER, value: '桃園區中正路 1 號附近' });
  let answer;
  const native = { reverseGeocode: jest.fn(() => new Promise(resolve => { answer = resolve; })) };
  const lookup = createAddressLookup({ native, store });
  expect(lookup.lookup(DOG_4, { retry: true })).toBeUndefined();
  await flush();
  expect(native.reverseGeocode).toHaveBeenCalledTimes(1);
  // DOG_4's geocoder answer is still out; OTHER comes from the phone at once.
  lookup.lookup(OTHER);
  await flush();
  expect(lookup.lookup(OTHER)).toBe('桃園區中正路 1 號附近');
  answer(JSON.stringify(nearDog4));
  await flush();
  await flush();
  expect(lookup.lookup(DOG_4)).toBe('蘆竹區大竹北路 630 巷 21 號附近');
});
