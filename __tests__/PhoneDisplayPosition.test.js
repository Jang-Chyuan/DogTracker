import { stablePhoneDisplay } from '../src/map/PhoneDisplayPosition';

// Moved from HistoryMemory.test.js when the old history geometry went (064).
test('low speed display jitter is held but cumulative departure, movement and unknown speed pass through', () => {
  const anchor = { latitude: 25, longitude: 121 };
  const small = { latitude: 25.00001, longitude: 121, accuracy: 15, rawSpeedKmh: 0.2 };
  expect(stablePhoneDisplay(anchor, small)).toBe(anchor);
  expect(stablePhoneDisplay(anchor, { ...small, latitude: 25.0001 }).latitude).toBe(25.0001);
  expect(stablePhoneDisplay(anchor, { ...small, rawSpeedKmh: 20 }).latitude).toBe(small.latitude);
  expect(stablePhoneDisplay(anchor, { ...small, rawSpeedKmh: null }).latitude).toBe(small.latitude);
  expect(small.latitude).toBe(25.00001);
});
