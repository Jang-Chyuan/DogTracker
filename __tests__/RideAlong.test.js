import { createRideDetector, ridesAlong } from '../src/placement/RideAlong';
import { mergeDogMarkers, heldLabel, heldSentence } from '../src/map/DogMerge';

const NOW = 1_800_000_000_000;
const phoneAt = (second, speedKmh) => ({ latitude: 25 + second * 1e-5, longitude: 121, speedKmh, timestamp: NOW + second * 1000 });

function drive(speeds) {
  const detector = createRideDetector();
  speeds.forEach((speed, index) => detector.add(phoneAt(index * 5, speed), NOW + index * 5000));
  return { detector, now: NOW + (speeds.length - 1) * 5000 };
}

test('the phone is riding only while it keeps driving speed with a fresh fix', () => {
  const { detector, now } = drive([40, 45, 50, 48]);
  expect(detector.ride(now)).toMatchObject({ riding: true });
  expect(detector.ride(now + 20000)).toBeNull();
  const walking = drive([4, 5, 4, 30]);
  expect(walking.detector.ride(walking.now)).toBeNull();
});

test('a dog rides along only when heard loudly and blind', () => {
  const ride = { riding: true, coordinate: { latitude: 25.01, longitude: 121 } };
  const close = { bleRssi: -45, bleRssiAt: NOW - 5000, lastGoodAt: NOW - 120000 };
  expect(ridesAlong(close, ride, NOW)).toBe(true);
  expect(ridesAlong({ ...close, bleRssi: -90 }, ride, NOW)).toBe(false);
  expect(ridesAlong({ ...close, lastGoodAt: NOW - 10000 }, ride, NOW)).toBe(false);
  expect(ridesAlong({ ...close, bleRssiAt: NOW - 300000 }, ride, NOW)).toBe(false);
  expect(ridesAlong(close, null, NOW)).toBe(false);
});

test('the map draws a riding dog with the phone, without calling it out', () => {
  const packet = { slave_id: 4, master_id: 7, received_at: NOW, slave_lat: 0, slave_lon: 0, source: 'ble' };
  const ride = { riding: true, coordinate: { latitude: 25.01, longitude: 121.02 } };
  const statuses = { 4: { bleRssi: -40, bleRssiAt: NOW, lastGoodAt: NOW - 600000 } };
  const cloudRows = [{ slave_id: 4, master_id: 7, received_at: NOW - 600000, slave_lat: 25, slave_lon: 121 }];
  const dog = mergeDogMarkers({ cloudRows, packetRows: [packet], statuses, ride, now: NOW, windowMs: 180000 })[0];
  expect(dog).toMatchObject({ coordinate: ride.coordinate, heldSource: 'ride', stale: false });
  expect(dog.heldReason).toBeNull();
  expect(heldLabel(dog)).toBeNull();
  expect(heldSentence(dog, String)).toBeNull();
});

test('readings from the future are not fresh after the clock is set back', () => {
  const detector = createRideDetector();
  const later = 3600000;
  for (let second = 0; second <= 30; second += 5) {
    detector.add({ latitude: 25, longitude: 121, speedKmh: 50, timestamp: later + second * 1000 }, later + second * 1000);
  }
  expect(detector.ride(30000)).toBeNull();
  expect(ridesAlong({ lastGoodAt: null, bleRssi: -40, bleRssiAt: later }, { riding: true, coordinate: {} }, 0)).toBe(false);
});
