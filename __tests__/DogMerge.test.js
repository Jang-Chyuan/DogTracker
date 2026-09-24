import { describeDogSource, mergeDogMarkers, MAX_AGE_MS } from '../src/map/DogMerge';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

const NOW = trackingPoint.receivedAt + 60000;
const cloudRow = (slaveId, receivedAt, masterId = 5) => ({
  slave_id: slaveId, master_id: masterId, received_at: receivedAt,
  slave_lat: 25.1, slave_lon: 121.6,
});
const merge = extra => mergeDogMarkers({ point: trackingPoint, now: NOW, ...extra });

test('late phone uploads do not replace a more recent BLE position', () => {
  const dogs = merge({ cloudRows: [{ ...cloudRow(7, NOW), track_at: trackingPoint.receivedAt - 600000 }] });
  expect(dogs[0]).toMatchObject({ source: 'ble', receivedAt: trackingPoint.receivedAt });
});

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

test('dogs of other Masters are shown as well, whatever this phone is holding', () => {
  // Confirmed 2026-09-18: the home map shows the whole team from both sources,
  // each dog at its newest row, with the source written next to it. Hiding the
  // other Masters' dogs while a link was up left the rest of the team invisible.
  const dogs = merge({ cloudRows: [cloudRow(4, trackingPoint.receivedAt + 8000)] });
  expect(dogs.map(dog => dog.slaveId)).toEqual([4, 7]);
  expect(dogs.find(dog => dog.slaveId === 4).source).toBe('cloud');
  expect(dogs.find(dog => dog.slaveId === 7).source).toBe('ble');
});

test('a quiet BLE feed changes nothing about which dogs are listed', () => {
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

// Seen on hardware 2026-09-18: the collar reported 0,0 with battery and speed
// present, while the cloud copy held real positions from the same seconds.
test('a BLE row without a GPS fix does not beat an older cloud position', () => {
  const dogs = merge({
    point: { ...trackingPoint, slaveLat: 0, slaveLon: 0 },
    cloudRows: [cloudRow(7, trackingPoint.receivedAt - 5000)],
  });
  expect(dogs).toHaveLength(1);
  expect(dogs[0]).toMatchObject({ source: 'cloud', masterId: 5 });
  expect(dogs[0].coordinate).toEqual({ latitude: 25.1, longitude: 121.6 });
});

test('without a fix the dog keeps its last BLE position and says it is not current', () => {
  const dogs = merge({
    point: { ...trackingPoint, slaveLat: 0, slaveLon: 0 },
    samples: [
      { id: 40, slaveId: 7, slave: { latitude: 0, longitude: 0 },
        receivedAt: trackingPoint.receivedAt - 1000 },
      { id: 39, slaveId: 7, slave: { latitude: 25.03, longitude: 121.56 },
        receivedAt: trackingPoint.receivedAt - 4000 },
    ],
  });
  expect(dogs[0]).toMatchObject({ source: 'ble', retained: true });
  expect(dogs[0].coordinate).toEqual({ latitude: 25.03, longitude: 121.56 });
});

test('cloud rows without a fix or out of range are not positions either', () => {
  const now = trackingPoint.receivedAt + 11 * 60 * 1000;
  const dogs = mergeDogMarkers({ point: null, now, cloudRows: [
    { ...cloudRow(4, now - 1000), slave_lat: 0, slave_lon: 0 },
    { ...cloudRow(5, now - 1000), slave_lat: 200 },
    cloudRow(8, now - 1000),
  ] });
  expect(dogs.map(dog => dog.slaveId)).toEqual([8]);
});

test('a dog heard without a fix draws no marker, while the others still do', () => {
  // The collar is heard but has no position yet, and this phone has no earlier
  // fix for it: that dog gets no marker, which is not a reason to drop the dog
  // another Master is reporting.
  const dogs = merge({
    point: { ...trackingPoint, slaveLat: 0, slaveLon: 0 },
    cloudRows: [cloudRow(4, trackingPoint.receivedAt + 1000)],
  });
  expect(dogs.map(dog => dog.slaveId)).toEqual([4]);
  expect(merge({
    point: { ...trackingPoint, slaveLat: 0, slaveLon: 0 }, cloudRows: [],
  })).toEqual([]);
});

