import { createHoldTracker, HOLD_CONFIG } from '../src/placement/IndoorHold';
import { offset } from '../__fixtures__/IndoorScenarios';
import { nearbyOpposedFixes } from '../__fixtures__/IndoorNearbyCounterexample';

// Invented geometry near Taoyuan station. These tests assert individual
// departures, not that every nearby GPS point belongs to one all-day stay.
const ORIGIN = { latitude: 24.9892, longitude: 121.3132 };
const good = (time, metres = 0) => ({ time, ...offset(ORIGIN, metres, 0),
  satellites: 9, hdop: 0.9, slave_id: 6, master_id: 1 });
const weak = (time, metres = 0) => ({ ...good(time, metres), satellites: 4, hdop: 4 });
const none = time => ({ ...good(time), latitude: 0, longitude: 0, satellites: 0, hdop: 655.35 });
const classify = rows => ({ environment: 'window', observedAt: Math.max(...rows.map(row => row.track_at)) });

function heldTracker(usbPresent = 0) {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify });
  const push = row => tracker.push({ ...row, usb_present: usbPresent });
  push(good(0));
  push(good(5000));
  for (let time = 10000; time <= 125000; time += 5000) push(none(time));
  expect(tracker.current()).not.toBeNull();
  for (let time = 130000; time <= 205000; time += 5000) push(good(time));
  return tracker;
}

test('fresh window evidence survives two opposed good-quality jumps after good fixes at the anchor', () => {
  const tracker = heldTracker();
  expect(tracker.push(good(210000, 90))).toBeNull();
  expect(tracker.push(good(215000, -90))).toBeNull();
  expect(tracker.current()).not.toBeNull();
});

test('a measured weak return breaks good departure candidates instead of accumulating two excursions', () => {
  const tracker = heldTracker();
  tracker.push(good(210000, 90));
  tracker.push(good(215000, 90));
  tracker.push(weak(220000));
  tracker.push(good(240000, 90));
  expect(tracker.push(good(245000, 90))).toBeNull();
  expect(tracker.current()).not.toBeNull();
});

test('steady good fixes at a new place release within thirty seconds of continuous agreement', () => {
  const tracker = heldTracker();
  const events = [];
  for (let time = 210000; time <= 240000; time += 5000) {
    const event = tracker.push(good(time, 90));
    if (event) events.push(event);
  }
  expect(events).toMatchObject([{ type: 'end', time: 240000, why: 'good-fixes-away' }]);
  expect(tracker.current()).toBeNull();
});

test('nearby departure still releases with consistent good fixes sixty-five metres away', () => {
  const tracker = heldTracker();
  const events = [];
  for (let time = 210000; time <= 270000; time += 10000) {
    const event = tracker.push(good(time, 65));
    if (event) events.push(event);
  }
  expect(events).toMatchObject([{ type: 'end', time: 270000, why: 'good-fixes-nearby' }]);
});

test('nearby fixes alternating across the anchor do not become a steady departure', () => {
  const tracker = heldTracker();
  const events = [];
  for (let time = 210000, index = 0; time <= 330000; time += 10000, index += 1) {
    const event = tracker.push(good(time, index % 2 ? -65 : 65));
    if (event) events.push(event);
  }
  expect(events).toEqual([]);
  expect(tracker.current()).not.toBeNull();
});

test('a sparse collar still releases when its separate fixes agree at the new location', () => {
  const tracker = heldTracker();
  tracker.push(good(210000, 90));
  tracker.push(good(270000, 90));
  expect(tracker.push(good(330000, 90))).toMatchObject({ type: 'end', why: 'good-fixes-away' });
});

test('a nearby release is not swallowed by old parked fixes on the next weak packet', () => {
  const tracker = heldTracker();
  for (let time = 210000; time < 330000; time += 10000) tracker.push(good(time, 65));
  expect(tracker.current()).toBeNull();
  // At this point the last two minutes contain a minute-long cluster at the
  // departure location. It belongs to the release, not a new stop.
  expect(tracker.push(weak(330000, 65))).toBeNull();
  expect(tracker.current()).toBeNull();
});

test('a slow genuine walk leaves the anchor even with fresh window evidence', () => {
  const tracker = heldTracker();
  const events = [];
  for (let time = 210000; time <= 510000; time += 5000) {
    const event = tracker.push(good(time, (time - 210000) / 2000));
    if (event) events.push(event);
  }
  expect(events.some(event => event.type === 'end')).toBe(true);
  expect(tracker.current()).toBeNull();
});

test('invented opposed nearby fixes retain a hold without suppressing a later true departure', () => {
  const tracker = heldTracker();
  const events = nearbyOpposedFixes(210000).map(row => tracker.push(row)).filter(Boolean);
  expect(events).toEqual([]);
  expect(tracker.current()).not.toBeNull();
  // Ambiguous offset fixes are not ground truth: a later continuing
  // departure must still release the hold.
  const leaving = [];
  for (let time = 1010000; time <= 1040000; time += 5000) {
    const event = tracker.push(good(time, 220));
    if (event) leaving.push(event);
  }
  expect(leaving.some(event => event.type === 'end')).toBe(true);
});

test.each([['charging', 1], ['window', 0]])('%s holds release promptly on a continuous good-GPS drive', (_label, usb) => {
  const tracker = heldTracker(usb);
  const events = [];
  for (let time = 210000; time <= 225000; time += 5000) {
    const event = tracker.push(good(time, 200 + (time - 210000) / 100));
    if (event) events.push(event);
  }
  expect(events).toMatchObject([{ type: 'end', time: 220000, why: 'good-fixes-away' }]);
  expect(tracker.current()).toBeNull();
});

test('consistent good fixes on a curved drive do not wait for two minutes of travel slices', () => {
  const tracker = heldTracker(1);
  const positions = [[200, 0], [245, 15], [280, 45]];
  const events = positions.map(([north, east], index) => tracker.push({
    ...good(210000 + index * 5000), ...offset(ORIGIN, north, east),
  })).filter(Boolean);
  expect(events).toMatchObject([{ type: 'end', time: 220000, why: 'good-fixes-away' }]);
});

test('a genuine run with good GPS is not trapped by the agreement radius', () => {
  const tracker = heldTracker();
  const events = [];
  for (let time = 210000; time <= 230000; time += 5000) {
    const event = tracker.push(good(time, 120 + (time - 210000) / 250));
    if (event) events.push(event);
  }
  expect(events).toMatchObject([{ type: 'end', time: 230000, why: 'good-fixes-away' }]);
});

test('three far but opposed good fixes are not a continuing drive away', () => {
  const tracker = heldTracker(1);
  const events = [200, -200, 200].map((metres, index) => tracker.push(good(210000 + index * 5000, metres)))
    .filter(Boolean);
  expect(events).toEqual([]);
  expect(tracker.current()).not.toBeNull();
});
