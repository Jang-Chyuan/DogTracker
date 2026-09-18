import { describeDogSource, mergeDogMarkers, MAX_AGE_MS } from '../src/map/DogMerge';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

const NOW = trackingPoint.receivedAt + 60000;
const cloudRow = (slaveId, receivedAt, masterId = 5) => ({
  slave_id: slaveId, master_id: masterId, received_at: receivedAt,
  slave_lat: 25.1, slave_lon: 121.6,
});
const merge = extra => mergeDogMarkers({ point: trackingPoint, now: NOW, ...extra });

test('the dog keeps its BLE position while that is the newest row', () => {
  const dogs = merge({ cloudRows: [cloudRow(7, trackingPoint.receivedAt - 5000)] });
  expect(dogs).toHaveLength(1);
  expect(dogs[0]).toMatchObject({ slaveId: 7, source: 'ble', masterId: 3 });
  expect(dogs[0].coordinate).toEqual({ latitude: 25.033, longitude: 121.5654 });
});

test('a newer cloud row moves the same dog and records which Master reported it', () => {
  const dogs = merge({ cloudRows: [cloudRow(7, trackingPoint.receivedAt + 8000)] });
  expect(dogs).toHaveLength(1);
  expect(dogs[0]).toMatchObject({ slaveId: 7, source: 'cloud', masterId: 5 });
  expect(dogs[0].coordinate).toEqual({ latitude: 25.1, longitude: 121.6 });
  expect(describeDogSource(dogs[0])).toBe('經 Master 5・雲端');
});

test('rows of the same second keep the BLE position, which this phone timed itself', () => {
  const dogs = merge({ cloudRows: [cloudRow(7, trackingPoint.receivedAt)] });
  expect(dogs[0].source).toBe('ble');
});

test('a dog only in the cloud stays hidden while a Master is connected', () => {
  const dogs = merge({ cloudRows: [cloudRow(4, trackingPoint.receivedAt + 8000)] });
  expect(dogs.map(dog => dog.slaveId)).toEqual([7]);
});

test('once the BLE feed goes quiet every dog in the cloud is shown', () => {
  const now = trackingPoint.receivedAt + 11 * 60 * 1000;
  const dogs = mergeDogMarkers({
    point: trackingPoint, now,
    cloudRows: [cloudRow(4, now - 1000), cloudRow(9, now - 2000, 7)],
  });
  expect(dogs.map(dog => dog.slaveId)).toEqual([4, 7, 9]);
  expect(dogs.find(dog => dog.slaveId === 7).source).toBe('ble');
});

test('without any BLE row the cloud copy is the only source', () => {
  const dogs = mergeDogMarkers({ point: null, now: NOW, cloudRows: [cloudRow(4, NOW - 1000)] });
  expect(dogs.map(dog => dog.slaveId)).toEqual([4]);
});

test('positions older than 24 hours leave the home map, and broken rows are ignored', () => {
  const now = trackingPoint.receivedAt + MAX_AGE_MS + 1000;
  expect(mergeDogMarkers({ point: trackingPoint, now, cloudRows: [] })).toEqual([]);
  const dogs = mergeDogMarkers({ point: null, now: NOW, cloudRows: [
    { ...cloudRow(4, NOW - 1000), slave_lat: null },
    { ...cloudRow(5, NOW - 1000), slave_lon: 'x' },
    { ...cloudRow(6, null) },
    cloudRow(8, NOW - 1000),
  ] });
  expect(dogs.map(dog => dog.slaveId)).toEqual([8]);
});

test('a retained BLE position says so, so a stale marker is not read as current', () => {
  const dogs = merge({
    point: { ...trackingPoint, slaveLat: null, slaveLon: null },
    samples: [{ id: 41, slave: { latitude: 25, longitude: 121 }, slaveId: 7,
      receivedAt: trackingPoint.receivedAt - 3000 }],
  });
  expect(dogs[0]).toMatchObject({ source: 'ble', retained: true });
  expect(describeDogSource(dogs[0])).toBe('BLE・最後有效位置，非最新定位');
});
