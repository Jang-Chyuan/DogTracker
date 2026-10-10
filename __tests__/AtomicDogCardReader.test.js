import { createAtomicDogCardReader } from '../src/map/AtomicDogCardReader';

const cloud = value => ({ local: [], cloud: [{ activity: value }], battery: [{ source: 'cloud', battery_percentage: value }] });

test('card cloud readings freeze through pages/failure, while failure allows local rows, then publish after success', async () => {
  let rows = cloud(80);
  const database = { dogCardRows: jest.fn(async owner => owner ? rows : { local: [{ activity: 7 }], cloud: [], battery: [] }) };
  const reader = createAtomicDogCardReader(database, 'a');
  reader.update(false, 0);
  const before = await reader.read(7, 0);
  reader.update(true, 0);
  rows = cloud(20);
  expect(await reader.read(7, 0)).toBe(before);
  expect(await reader.read(8, 0)).toEqual({ local: [], cloud: [], battery: [] });
  expect(database.dogCardRows).toHaveBeenCalledTimes(1);
  reader.update(false, 0); // failed
  expect(await reader.read(7, 0)).toEqual({ ...before, local: [{ activity: 7 }] });
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
  expect(await pending).toEqual({ local: [], cloud: [], battery: [] });
  const replacement = createAtomicDogCardReader(database, 'b');
  replacement.update(true, 0);
  expect(await replacement.read(7, 0)).toEqual({ local: [], cloud: [], battery: [] });
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
