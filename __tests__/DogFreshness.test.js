import { dogFreshness } from '../src/map/DogFreshness';

const NOW = new Date(2026, 8, 30, 23, 0).getTime();
const dog = ageMs => ({ coordinate: { latitude: 25, longitude: 121 }, lastPositionAt: NOW - ageMs });

test('a fix within two minutes is a normal marker', () => {
  expect(dogFreshness(dog(90000), NOW)).toEqual({ tier: 'fresh', label: null });
});

test('two to ten minutes stays on the map and says how long ago', () => {
  expect(dogFreshness(dog(4 * 60000 + 20000), NOW)).toEqual({ tier: 'recent', label: '最後位置・4 分鐘前' });
});

test('ten minutes to a day stays on the map with the clock time of the fix', () => {
  const sixHours = { coordinate: { latitude: 25, longitude: 121 }, lastPositionAt: new Date(2026, 8, 30, 16, 32).getTime() };
  expect(dogFreshness(sixHours, NOW)).toEqual({ tier: 'old', label: '最後位置 16:32' });
});

test('past a day, or with no fix at all, the dog is not on the live map', () => {
  expect(dogFreshness(dog(25 * 3600000), NOW).tier).toBe('gone');
  expect(dogFreshness({ coordinate: null, lastPositionAt: NOW }, NOW).tier).toBe('gone');
});

test('the age is measured from the last fix, not the last packet', () => {
  // Packets every second, but the last valid fix was 6 hours ago.
  const talking = { ...dog(6 * 3600000), lastPacketAt: NOW - 1000 };
  expect(dogFreshness(talking, NOW).tier).toBe('old');
});
