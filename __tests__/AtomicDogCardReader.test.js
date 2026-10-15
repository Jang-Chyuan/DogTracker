import { createAtomicDogCardReader } from '../src/map/AtomicDogCardReader';

const cloud = value => ({ local: [], cloud: [{ activity: value }], battery: [{ source: 'cloud', battery_percentage: value }] });

test('card cloud readings freeze through pages/failure, local rows stay live, then publish after success', async () => {
  let rows = cloud(80);
  const local = { local: [{ activity: 7 }], cloud: [], battery: [{ source: 'ble', battery_percentage: 55 }] };
  const database = { dogCardRows: jest.fn(async owner => owner ? rows : local) };
  const reader = createAtomicDogCardReader(database, 'a');
  reader.update(false, 0);
  const before = await reader.read(7, 0);
  reader.update(true, 0);
  rows = cloud(20);
  // While the cloud side is held this phone's rows are still read (owner-less).
  expect(await reader.read(7, 0)).toEqual({ local: local.local, cloud: before.cloud,
    battery: [...local.battery, ...before.battery], since: 0 });
  expect(database.dogCardRows).toHaveBeenLastCalledWith(null, 7, 0);
  // A dog first opened meanwhile has its local rows, no cloud rows yet.
  expect(await reader.read(8, 0)).toEqual({ local: local.local, cloud: [], battery: local.battery, since: 0 });
  expect(database.dogCardRows.mock.calls.filter(([owner]) => owner === 'a')).toHaveLength(1);
  reader.update(false, 0); // failed
  expect(await reader.read(7, 0)).toEqual({ local: local.local, cloud: before.cloud, battery: [...local.battery, ...before.battery],
    since: 0 });
  expect(database.dogCardRows).toHaveBeenLastCalledWith(null, 7, 0);
  reader.update(true, 1); // success published while download slot still owns busy
  expect((await reader.read(7, 0)).cloud).toEqual(before.cloud);
  reader.update(false, 1);
  expect((await reader.read(7, 0)).cloud).toEqual(rows.cloud);
});

test('late reads spanning a download cannot replace cloud readings; a new owner reader has no old cache', async () => {
  let finish;
  const database = { dogCardRows: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  const reader = createAtomicDogCardReader(database, 'a');
  const pending = reader.read(7, 0);
  reader.update(true, 0);
  finish(cloud(10));
  expect(await pending).toEqual({ local: [], cloud: [], battery: [], since: 0 });
  const replacement = createAtomicDogCardReader(database, 'b');
  replacement.update(true, 0);
  const fresh = replacement.read(7, 0);
  finish(cloud(10));
  expect(await fresh).toEqual({ local: [], cloud: [], battery: [], since: 0 });
  expect(database.dogCardRows).toHaveBeenLastCalledWith(null, 7, 0);
});

test('card fence rejects failed pages without any rendered busy transition and rejects a replaced engine scope', async () => {
  let publication = { scope: {}, owner: 'a', generation: 1, attempt: 0, pending: false, mapSuccessRevision: 0 };
  let rows = cloud(80), finish;
  const database = { dogCardRows: jest.fn(async owner => owner ? rows : { local: [], cloud: [], battery: [] }) };
  const reader = createAtomicDogCardReader(database, 'a', () => publication);
  reader.update(false, null);
  const before = await reader.read(7, 0);
  publication = { ...publication, attempt: 1, pending: true }; // failure/abort survived a coalesced busy lifecycle
  rows = cloud(20);
  expect(await reader.read(7, 0)).toEqual(before);
  expect(database.dogCardRows).toHaveBeenLastCalledWith(null, 7, 0);
  publication = { ...publication, pending: false, mapSuccessRevision: 1 };
  reader.update(false, 1);
  database.dogCardRows.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const late = reader.read(7, 0);
  publication = { ...publication, scope: {} }; // same owner/counters, different scheduler instance
  finish(rows);
  expect((await late).cloud).toEqual(before.cloud);
});

// 2026-10-15: where the activity rows begin goes through to the card (the
// 活動量 row's lookback edge), whichever side of the rows is held.
test('the read says where its activity rows begin', async () => {
  const database = { dogCardRows: jest.fn(async () => ({ local: [], cloud: [], battery: [], since: 123 })) };
  const reader = createAtomicDogCardReader(database, 'a');
  expect((await reader.read(7, 123)).since).toBe(123);
  reader.update(true, 0);
  database.dogCardRows.mockImplementationOnce(async () => ({ local: [], cloud: [], battery: [] }));
  expect((await reader.read(7, 456)).since).toBe(456);
});
