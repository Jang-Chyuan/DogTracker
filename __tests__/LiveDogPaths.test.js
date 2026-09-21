import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import { liveDogPaths } from '../src/map/LiveDogPaths';

const ble = (id, slaveId, extra = {}) => ({ id, slaveId, masterId: 5,
  receivedAt: id * 1000, slaveLat: 25 + id / 100000, slaveLon: 121, ...extra });
const cloud = slaveId => [1, 2].map(id => ({ slave_id: slaveId, master_id: 7,
  received_at: id * 1000, slave_lat: 24 + id / 100000, slave_lon: 121 }));

test('alternating BLE dogs retain separate paths across chunks and unrelated updates', () => {
  const window = createLiveRouteWindow({ chunkSize: 2 });
  window.append([ble(1, 8), ble(2, 4), ble(3, 8), ble(4, 4)]);
  const rows = [...cloud(8), ...cloud(4), ...cloud(6)];
  const before = liveDogPaths(window.snapshot(), rows, 0, 4000);
  const dog8 = before.find(track => track.slaveId === 8);
  expect(dog8.source).toBe('ble');
  expect(dog8.segments[0].map(point => point.time)).toEqual([1000, 3000]);
  expect(before.find(track => track.slaveId === 4).source).toBe('ble');
  expect(before.find(track => track.slaveId === 6).source).toBe('cloud');
  window.append([ble(5, 4), ble(6, 6)]);
  expect(liveDogPaths(window.snapshot(), rows, 0, 6000).find(track => track.slaveId === 8)).toEqual(dog8);
  // Previously returned geometry must not change when later chunks arrive.
  expect(dog8.segments[0].map(point => point.time)).toEqual([1000, 3000]);
});

test('only the silent dog falls back; an invalid fix does not renew source ownership', () => {
  const window = createLiveRouteWindow({ chunkSize: 2 });
  window.append([ble(1, 8), ble(2, 8), ble(120, 4), ble(121, 4),
    ble(122, 8, { slaveLat: 0, slaveLon: 0 })]);
  const paths = liveDogPaths(window.snapshot(), [...cloud(8), ...cloud(4)], 0, 123000);
  expect(paths.find(track => track.slaveId === 8).source).toBe('cloud');
  expect(paths.find(track => track.slaveId === 4).source).toBe('ble');
});

test('invalid samples break each dog path and reset removes all BLE ownership', () => {
  const window = createLiveRouteWindow({ chunkSize: 2 });
  window.append([ble(1, 8), ble(2, 4), ble(3, 8, { slaveLat: 0, slaveLon: 0 }),
    ble(4, 4), ble(5, 8), ble(6, 8)]);
  const paths = liveDogPaths(window.snapshot(), cloud(8), 0, 6000);
  expect(paths.find(track => track.slaveId === 8).segments[0].map(point => point.time)).toEqual([5000, 6000]);
  window.reset();
  expect(liveDogPaths(window.snapshot(), cloud(8), 0, 6000)[0].source).toBe('cloud');
});
