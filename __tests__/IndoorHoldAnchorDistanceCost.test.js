import { createHoldTracker, HOLD_CONFIG } from '../src/placement/IndoorHold';

const home = { latitude: 20, longitude: 100 };
const good = time => ({ ...home, time, satellites: 9, hdop: 1, master_id: 7 });
function heldTracker() {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: () => null });
  [good(0), good(5000), good(10000)].forEach(row => tracker.push(row));
  for (let time = 15000; time <= 200000; time += 5000)
    tracker.push({ time, latitude: 0, longitude: 0, satellites: 0, hdop: 655.35, master_id: 7 });
  expect(tracker.current()).not.toBeNull();
  return tracker;
}

test('a charging weak fix reuses the same initial anchor distance for both return checks', () => {
  const tracker = heldTracker();
  const sqrt = jest.spyOn(Math, 'sqrt');
  let event, calls;
  try {
    event = tracker.push({ ...home, latitude: home.latitude + 1 / 111320,
      time: 205000, satellites: 2, hdop: 6, usb_present: 1, master_id: 7 });
    calls = sqrt.mock.calls.length;
  } finally { sqrt.mockRestore(); }
  expect(event).toBeNull();
  expect(tracker.current().coordinate).toEqual(home);
  // This public decision path needs one distance, not two identical ones.
  expect(calls).toBeLessThanOrEqual(1);
});

test('a missing fix does not evaluate an initial anchor distance', () => {
  const tracker = heldTracker();
  const sqrt = jest.spyOn(Math, 'sqrt');
  let event, calls;
  try {
    event = tracker.push({ time: 205000, latitude: 0, longitude: 0,
      satellites: 0, hdop: 655.35, usb_present: 1, master_id: 7 });
    calls = sqrt.mock.calls.length;
  } finally { sqrt.mockRestore(); }
  expect(event).toBeNull();
  expect(tracker.current().coordinate).toEqual(home);
  expect(calls).toBe(0);
});

test('promoting the previous good fix and refining the current one keep separate distances', () => {
  const tracker = heldTracker();
  const point = { ...home, latitude: home.latitude + 1 / 111320 };
  tracker.push({ ...good(205000), ...point, usb_present: 1 });
  const sqrt = jest.spyOn(Math, 'sqrt');
  let event, calls;
  try {
    event = tracker.push({ ...good(210000), ...point, usb_present: 1 });
    calls = sqrt.mock.calls.length;
  } finally { sqrt.mockRestore(); }
  expect(event).toBeNull();
  expect(tracker.current().coordinate).toEqual(home);
  // Each observation checks its initial anchor once and its refined median once.
  expect(calls).toBeLessThanOrEqual(4);
});

test('cold anchoring compares a retained good-fix pair once in either direction', () => {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: () => null });
  const retained = HOLD_CONFIG.anchorFixes * 8;
  tracker.seed(Array.from({ length: retained }, (_, i) => good(i * 1000)));
  const sqrt = jest.spyOn(Math, 'sqrt');
  let calls;
  try {
    tracker.push({ time: 130000, latitude: 0, longitude: 0, satellites: 0,
      hdop: 655.35, usb_present: 1, master_id: 7 });
    calls = sqrt.mock.calls.length;
  } finally { sqrt.mockRestore(); }
  expect(tracker.current().coordinate).toEqual(home);
  // The two non-pair distances verify that the seeded window really stayed.
  expect(calls).toBeGreaterThan(retained);
  expect(calls).toBeLessThanOrEqual(retained * (retained + 1) / 2 + 2);
});

test('equal stayed groups prefer the newer group over an isolated final fix', () => {
  const middle = { ...home, latitude: home.latitude + 60 / 111320 };
  const stray = { ...home, latitude: home.latitude + 120 / 111320 };
  const tracker = createHoldTracker({ ...HOLD_CONFIG, anchorStayMs: 20000 },
    { classify: () => null });
  tracker.seed([
    ...Array.from({ length: 20 }, (_, i) => good(i * 2000)),
    ...Array.from({ length: 20 }, (_, i) => ({ ...good(40000 + i * 2000), ...middle })),
    { ...good(80000), ...stray },
  ]);
  tracker.push({ time: 140000, latitude: 0, longitude: 0, satellites: 0,
    hdop: 655.35, usb_present: 1, master_id: 7 });
  expect(tracker.current().coordinate).toEqual(middle);
  expect(tracker.current().anchorAt).toBe(78000);
});
