import { t as i18nT } from '../src/i18n';
import { mergeDogMarkers, keepDogs, MAX_AGE_MS, MAX_DOGS } from '../src/map/DogMerge';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

const NOW = trackingPoint.receivedAt + 60000;
const cloudRow = (slaveId, receivedAt, masterId = 5) => ({
  slave_id: slaveId, master_id: masterId, received_at: receivedAt,
  slave_lat: 25.1, slave_lon: 121.6,
});
const merge = extra => mergeDogMarkers({ point: trackingPoint, now: NOW, ...extra });

test('fresh no-fix packets keep the last position visible without changing its timestamp', () => {
  const old = cloudRow(4, NOW - 121000);
  const packet = { ...cloudRow(4, NOW), slave_lat: 0, slave_lon: 0,
    battery_percentage: 55, battery_valid: 1, distance_meters: 999999, source: 'ble' };
  const options = { point: null, cloudRows: [old], packetRows: [packet], now: NOW, windowMs: 120000 };
  expect(mergeDogMarkers(options)[0]).toMatchObject({
    lastPacketAt: NOW, lastPositionAt: NOW - 121000, stale: false,
    batteryPercentage: 55, distanceMeters: null, communicationStatus: i18nT("c736"),
  });
  expect(mergeDogMarkers({ ...options, now: NOW + 121000 })[0].communicationStatus).toBe(i18nT("c735"));
  expect(mergeDogMarkers({ ...options, packetRows: [{ ...packet, slave_lat: 25, slave_lon: 121, distance_meters: 10 }] })[0])
    .toMatchObject({ stale: false, lastPositionAt: NOW, distanceMeters: 10, communicationStatus: i18nT("c737") });
});

test('default live marker expires only after three minutes without packets', () => {
  const options = { point: null, cloudRows: [cloudRow(104, NOW)], now: NOW + 180000 };
  expect(mergeDogMarkers(options)[0].stale).toBe(false);
  expect(mergeDogMarkers({ ...options, now: NOW + 180001 })[0].stale).toBe(true);
});

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

test('positions older than 24 hours stay on the home map (v3 §6), and broken rows are ignored', () => {
  const now = trackingPoint.receivedAt + MAX_AGE_MS + 1000;
  const old = mergeDogMarkers({ point: trackingPoint, now, cloudRows: [] });
  expect(old.map(dog => [dog.slaveId, dog.fixAt, dog.fixSource])).toEqual([[7, trackingPoint.receivedAt, 'ble']]);
  // A caller may still limit what it reads.
  expect(mergeDogMarkers({ point: trackingPoint, now, cloudRows: [], maxAgeMs: MAX_AGE_MS })).toEqual([]);
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
  expect(dogs.filter(dog => !dog.stale).map(dog => dog.slaveId)).toEqual([4]);
  expect(merge({
    point: { ...trackingPoint, slaveLat: 0, slaveLon: 0 }, cloudRows: [],
  })).toEqual([expect.objectContaining({ slaveId: 7, coordinate: null, stale: true,
    communicationStatus: i18nT("c736") })]);
});


// Audit F4: the merge used to sort by ID and keep the first MAX_DOGS (20), so
// once the cloud roster passed 20 the highest IDs vanished from the map, the
// card and the alerts, the live BLE dog among them.
describe('more dogs than MAX_DOGS', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const old = (slave, age) => ({ slave_id: slave, master_id: 7, slave_lat: 24.9, slave_lon: 121.3,
    track_at: NOW - age, received_at: NOW - age });
  const live = { slaveId: 30, masterId: 7, slaveLat: 24.95, slaveLon: 121.31, receivedAt: NOW - 1000 };
  const ids = dogs => dogs.map(dog => dog.slaveId);
  const sorted = list => [...list].sort((a, b) => a - b);

  test('the live BLE dog with the highest ID stays, ahead of 21 month-old cloud dogs (probe B3)', () => {
    const cloudRows = Array.from({ length: 21 }, (_, index) => old(index + 1, 30 * DAY));
    const dogs = mergeDogMarkers({ point: live, cloudRows, now: NOW });
    expect(dogs).toHaveLength(MAX_DOGS);
    expect(dogs.find(dog => dog.slaveId === 30)).toMatchObject({ source: 'ble' });
    // Still listed by dog, as before.
    expect(ids(dogs)).toEqual(sorted(ids(dogs)));
  });

  test('every dog heard in the last 24 hours stays, however many; only stale cloud dogs are cut, oldest first', () => {
    const recent = Array.from({ length: 24 }, (_, index) => old(100 + index, (index + 1) * 60000));
    const stale = [old(1, 2 * DAY), old(2, 3 * DAY), old(3, 9 * DAY)];
    const dogs = mergeDogMarkers({ point: live, cloudRows: [...stale, ...recent], now: NOW });
    expect(dogs).toHaveLength(25);
    expect(ids(dogs)).toEqual(sorted([30, ...recent.map(row => row.slave_id)]));

    const few = mergeDogMarkers({ point: live, cloudRows: [...stale, ...recent.slice(0, 18)], now: NOW });
    // 18 recent + live: one slot left, for the most recently heard stale dog.
    expect(ids(few)).toEqual(sorted([1, 30, ...recent.slice(0, 18).map(row => row.slave_id)]));
  });

  test('a dog this phone heard over BLE is never cut, even when it has been silent for days', () => {
    const cloudRows = Array.from({ length: 25 }, (_, index) => old(index + 1, 2 * DAY + index * 60000));
    const packetRows = [{ slave_id: 99, master_id: 7, source: 'ble', received_at: NOW - 5 * DAY,
      slave_lat: 24.9, slave_lon: 121.3 }];
    const dogs = mergeDogMarkers({ point: null, cloudRows, packetRows, now: NOW });
    expect(dogs).toHaveLength(MAX_DOGS);
    expect(ids(dogs)).toContain(99);
    // The cut keeps the most recently heard stale dogs.
    expect(ids(dogs).filter(id => id !== 99)).toEqual(Array.from({ length: MAX_DOGS - 1 }, (_, index) => index + 1));
  });

  test('keepDogs leaves a list of MAX_DOGS or fewer untouched', () => {
    const list = [{ slaveId: 3, receivedAt: 0 }, { slaveId: 1, receivedAt: 0 }];
    expect(keepDogs(list, NOW)).toBe(list);
  });
});
