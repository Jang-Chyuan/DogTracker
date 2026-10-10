import { createAtomicDogSnapshot } from '../src/map/AtomicDogSnapshot';

test('download freezes the entire dog set, including BLE; completion waits for the complete DB read', () => {
  const gate = createAtomicDogSnapshot();
  const old = { dogs: [{ slaveId: 4, coordinate: { latitude: 25 } }], cloudDogs: { cloudCommit: null, ranges: { 4: 'old' } } };
  const initial = gate.select({ owner: 'a', ...old });
  const next = { dogs: [{ slaveId: 4, coordinate: { latitude: 26 } }, { slaveId: 7 }], cloudDogs: { cloudCommit: null, ranges: { 4: 'partial' } } };
  expect(gate.select({ owner: 'a', ...next, busy: true })).toBe(initial);
  expect(gate.select({ owner: 'a', ...next, success: 10 })).toBe(initial);
  const complete = gate.select({ owner: 'a', ...next, success: 10, cloudDogs: { cloudCommit: 10, ranges: { 4: 'new' } } });
  expect(complete.dogs).toBe(next.dogs);
  expect(complete.cloudDogs.ranges[4]).toBe('new');
  const local = [{ slaveId: 4, coordinate: { latitude: 26.1 } }];
  expect(gate.select({ owner: 'a', dogs: local, cloudDogs: complete.cloudDogs, success: 10 }).dogs).toBe(local);
});

test('cold download and account switch discard old account positions even during a download', () => {
  const gate = createAtomicDogSnapshot();
  expect(gate.select({ owner: 'a', dogs: [{ slaveId: 7 }], busy: true }).dogs).toEqual([]);
  gate.select({ owner: 'a', dogs: [{ slaveId: 7 }], cloudDogs: { cloudCommit: 1 }, success: 1 });
  expect(gate.select({ owner: 'b', dogs: [], busy: true }).dogs).toEqual([]);
  expect(gate.select({ owner: null, dogs: [], busy: true }).dogs).toEqual([]);
});

test('a cold committed cache is admitted once without claiming a fresh download or leaking across owners', () => {
  const gate = createAtomicDogSnapshot();
  const cached = { dogs: [{ slaveId: 4 }], cloudDogs: { loaded: true, cachedBaseline: true, cloudCommit: null } };
  const initial = gate.select({ owner: 'a', ...cached, busy: true });
  expect(initial.dogs).toEqual(cached.dogs);
  expect(initial.cloudDogs.cloudCommit).toBeNull();
  expect(gate.select({ owner: 'a', dogs: [{ slaveId: 6 }], cloudDogs: { ...cached.cloudDogs }, busy: true })).toBe(initial);
  expect(gate.select({ owner: 'b', dogs: [], cloudDogs: { loaded: false }, busy: true }).dogs).toEqual([]);
});
