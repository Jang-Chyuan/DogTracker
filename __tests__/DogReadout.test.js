import {
  bearingAndDistance,
  formatDistance,
  fromPhone,
  lowBattery,
  movement,
  phoneFix,
  positionAge,
  phoneNote,
  settleMovement,
} from '../src/map/DogReadout';

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
const at = { latitude: 24.9936, longitude: 121.301 };

test('distance and bearing between two nearby points', () => {
  // About 111 m due north, then about 101 m due east at this latitude.
  const north = bearingAndDistance(at, { latitude: at.latitude + 0.001, longitude: at.longitude });
  expect(Math.round(north.metres)).toBe(111);
  expect(Math.round(north.bearing)).toBe(0);
  const east = bearingAndDistance(at, { latitude: at.latitude, longitude: at.longitude + 0.001 });
  expect(Math.round(east.bearing)).toBe(90);
});

test('distances read in five-metre steps, then kilometres', () => {
  expect(formatDistance(3)).toBe('3 m');
  expect(formatDistance(118)).toBe('120 m');
  expect(formatDistance(1234)).toBe('1.2 km');
  expect(formatDistance(23456)).toBe('23 km');
});

test('the arrow turns with the map so it still points at the dog on screen', () => {
  const dog = { coordinate: { latitude: at.latitude, longitude: at.longitude + 0.001 } };
  expect(Math.round(fromPhone(dog, at, 0).bearing)).toBe(90);
  // Map rotated so that east is up: the dog is straight ahead.
  expect(Math.round(fromPhone(dog, at, 90).bearing) % 360).toBe(0);
  expect(fromPhone(dog, at).distance).toBe('100 m');
});

test('no direction without both positions, and the reason is kept', () => {
  expect(fromPhone({ coordinate: null }, at)).toEqual({ kind: 'no-dog' });
  expect(fromPhone({ coordinate: at }, null)).toEqual({ kind: 'no-phone' });
});

test('the phone fix is the live tracker position, usable for ten minutes and said when old', () => {
  expect(phoneFix({ running: true, ageSeconds: 3, position: at })).toEqual({ ...at, ageSeconds: 3 });
  expect(phoneNote(phoneFix({ running: true, ageSeconds: 3, position: at }))).toBe('');
  // An older fix still gives a direction; the card says how old, in minutes.
  expect(phoneFix({ running: true, ageSeconds: 45, position: at })).toEqual({ ...at, ageSeconds: 45 });
  expect(phoneNote(phoneFix({ running: true, ageSeconds: 45, position: at }))).toBe('手機位置 1 分鐘前');
  expect(phoneNote(phoneFix({ running: true, ageSeconds: 150, position: at }))).toBe('手機位置 2 分鐘前');
  expect(phoneFix({ running: true, ageSeconds: 601, position: at })).toBeNull();
  expect(phoneNote(null)).toBe('手機無定位，無法顯示距離');
  expect(phoneFix({ running: false, ageSeconds: 1, position: at })).toBeNull();
  expect(phoneFix(null)).toBeNull();
});

test('moving or still needs a current fix and a speed; otherwise it is unknown', () => {
  expect(movement({ speedKmh: 4 }, 'fresh')).toBe('moving');
  expect(movement({ speedKmh: 0.3 }, 'fresh')).toBe('still');
  expect(movement({ speedKmh: null }, 'fresh')).toBe('unknown');
  // An old fix says nothing about now, even if its speed was zero.
  expect(movement({ speedKmh: 0 }, 'recent')).toBe('unknown');
});

test('the position age does not tick in seconds', () => {
  const dog = ageMs => ({ coordinate: at, lastPositionAt: NOW - ageMs });
  expect(positionAge(dog(20000), 'fresh', NOW)).toBe('即時');
  expect(positionAge(dog(4 * 60000 + 30000), 'recent', NOW)).toBe('4 分鐘前');
  expect(positionAge({ coordinate: at, lastPositionAt: new Date(2026, 9, 2, 4, 6).getTime() }, 'old', NOW)).toBe('04:06');
  expect(positionAge({ coordinate: null }, 'gone', NOW)).toBe('無定位');
});

test('low battery is 20 % or less, and unknown is not low', () => {
  expect(lowBattery({ batteryPercentage: 15 })).toBe(true);
  expect(lowBattery({ batteryPercentage: 21 })).toBe(false);
  expect(lowBattery({ batteryPercentage: null })).toBe(false);
});

test('moving and still settle with a margin, so walking slowly does not flicker', () => {
  expect(settleMovement(null, 2)).toBe('moving');
  expect(settleMovement('moving', 1.2)).toBe('moving');
  expect(settleMovement('moving', 0.8)).toBe('moving');
  expect(settleMovement('moving', 0.4)).toBe('still');
  expect(settleMovement('still', 1.2)).toBe('still');
  expect(settleMovement('still', 1.6)).toBe('moving');
  expect(settleMovement(null, 1.2)).toBe('moving');
  expect(settleMovement('moving', NaN)).toBeNull();
});
