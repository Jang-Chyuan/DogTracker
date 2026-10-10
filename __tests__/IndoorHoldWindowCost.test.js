import { createHistoryHolds, HOLD_CONFIG } from '../src/placement/IndoorHold';

// Independent invented positions and relative clocks, no recorded route.
const home = { latitude: 20, longitude: 100 };
function input(count, intervalMs) {
  const good = Array.from({ length: 8 }, (_, i) => ({
    ...home, time: i * 10000, satellites: 9, hdop: 1,
  }));
  const weak = Array.from({ length: count }, (_, i) => ({
    ...home, time: 80000 + i * intervalMs, satellites: 2, hdop: 6,
    usb_present: 1,
  }));
  return [...good, ...weak];
}

// Count fixed-value policy reads instead of noisy wall clock. Computing
// cadence once per observation must not grow with every retained packet.
test.each([2000, 17000])('held-window policy work stays bounded at %i ms cadence', intervalMs => {
  const rows = input(80, intervalMs);
  let reads = 0;
  const config = { ...HOLD_CONFIG };
  Object.defineProperty(config, 'goodShareWindowMs', {
    get() { reads += 1; return HOLD_CONFIG.goodShareWindowMs; },
  });
  const pass = createHistoryHolds({ config, classify: () => null });
  pass.append(rows);
  expect(pass.output.at(-1).heldReason).toBeTruthy();
  expect(pass.output.at(-1)).toMatchObject(home);
  expect(pass.output.at(-1).raw_latitude).toBe(home.latitude);
  expect(reads).toBeLessThan(rows.length * 8);
});
