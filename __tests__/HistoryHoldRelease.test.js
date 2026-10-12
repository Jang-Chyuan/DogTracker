import { applyHistoryHolds } from '../src/placement/IndoorHold';
import { historyEdge, historyMovement } from '../src/history/HistoryMovement';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { offset } from '../__fixtures__/IndoorScenarios';

// Invented geometry near Taoyuan station; regular clocks are assumptions.
const origin = { latitude: 24.9892, longitude: 121.3132 };
const good = (time, metres, speed = null) => ({ time, ...offset(origin, metres, 0),
  satellites: 9, hdop: 1, speed_kmh: speed, master_id: 1, slave_id: 6 });
const weak = (time, metres) => ({ ...good(time, metres), satellites: 4, hdop: 4 });
const none = time => ({ ...good(time, 0), latitude: 0, longitude: 0, satellites: 0, hdop: 655.35 });
const classify = rows => ({ environment: 'window', observedAt: Math.max(...rows.map(r => r.track_at)) });
// Good fixes at the spot, two minutes without a fix (the hold starts), then
// good fixes back at the spot that keep it held.
const initial = [good(0, 0), good(5000, 0),
  ...Array.from({ length: 24 }, (_, i) => none(10000 + i * 5000)),
  ...Array.from({ length: 16 }, (_, i) => good(130000 + i * 5000, 0, 0))];
const timeline = rows => historyTimeline(rows, { subject: 'dog', dayStart: 0, dayEnd: 600000,
  range: { start: 0, end: 600000 }, holdOptions: { classify } });

// N1: after a confirmed departure, packets without a fix inside the walk were
// left on the anchor, so the walk bounced back to the spot between fixes.
test('a slow walk out of a hold with every third packet missing its fix is one walk', () => {
  const walk = Array.from({ length: 31 }, (_, i) => i % 3 === 2
    ? none(210000 + i * 10000) : good(210000 + i * 10000, i * 5, 1.8));
  const rows = [...initial, ...walk];
  const replay = applyHistoryHolds(rows, { classify });
  // Once the walk is confirmed, nothing after it starts stays on the anchor.
  const lastHeld = replay.filter(r => r.heldReason).at(-1).time;
  expect(replay.filter(r => r.time > lastHeld && r.heldReason)).toEqual([]);
  expect(replay.filter(r => r.time > lastHeld && r.satellites === 0)
    .every(r => r.latitude === 0 && r.longitude === 0 && r.heldSince === undefined)).toBe(true);
  const model = timeline(rows);
  expect(model.nodes.map(n => n.type)).toEqual(['departure', 'indoor', 'movement', 'end']);
  expect(model.sections.filter(s => s.type === 'gap')).toEqual([]);
  expect(model.distanceM).toBeGreaterThan(140);
  expect(model.distanceM).toBeLessThan(155);
});

// F2: a held row's raw fix is untrusted drift. Leaving the hold starts at
// the spot it was drawn at, not at drift on the far side of it.
test('leaving a hold does not add the distance from drift on the far side of the spot', () => {
  const from = { ...weak(0, 0), heldReason: 'window', raw_latitude: offset(origin, 150, 0).latitude,
    raw_longitude: origin.longitude };
  const edge = historyEdge(from, good(60000, -70, 4), 'dog');
  expect(edge.from).toMatchObject({ latitude: origin.latitude, longitude: origin.longitude });
  expect(edge.distanceM).toBeCloseTo(70, 0);
  expect(historyMovement([from, good(60000, -70, 4)], { subject: 'dog' }).distanceM).toBeCloseTo(70, 0);
});

test('the same far-side drift through the history replay counts only the walk from the spot', () => {
  // Weak drift 150 m east keeps the dog held; then it is seen walking south.
  const drift = Array.from({ length: 4 }, (_, i) => ({ ...weak(210000 + i * 10000, 0), ...offset(origin, 0, 150) }));
  const walk = Array.from({ length: 20 }, (_, i) => good(260000 + i * 10000, -10 * (i + 1), 3.6));
  const rows = [...initial, ...drift, ...walk];
  const replay = applyHistoryHolds(rows, { classify });
  expect(replay.find(r => r.time === drift.at(-1).time).heldReason).toBeTruthy();
  const model = timeline(rows);
  // The walk itself: 200 m south from the spot, not 150 m east first.
  expect(model.distanceM).toBeGreaterThan(195);
  expect(model.distanceM).toBeLessThan(205);
});

test('a phone leaving its stationary anchor does not add drift on the far side of it', () => {
  const at = (north, extra) => ({ ...offset(origin, north, 0), accuracy: 5, ...extra });
  const from = { ...at(0), time: 0, phoneStationary: true, phoneMotionState: 'stationary',
    raw_latitude: offset(origin, 40, 0).latitude, raw_longitude: origin.longitude };
  const to = { ...at(-30), time: 30000, phoneStationary: false, phoneMotionState: 'moving',
    raw_latitude: offset(origin, -30, 0).latitude, raw_longitude: origin.longitude };
  const edge = historyEdge(from, to, 'phone');
  expect(edge.from).toMatchObject({ latitude: origin.latitude });
  expect(edge.distanceM).toBeCloseTo(30, 0);
});

// F1(a): the stationary-tail check needs speeds; the live hold rows dropped them.
test('live hold rows carry the stored speed from the BLE table and the cloud copy', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    await db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,received_at,slave_lat,slave_lon,
      satellites,hdop,speed_kmh) VALUES(1,6,2000000,25,121,9,1,0.4)`);
    db.sqlite.prepare(`INSERT INTO supabase_dog_status(received_at,owner_user_id,master_id,slave_id,
      slave_lat,slave_lon,satellites,hdop,speed_kmh) VALUES(2005000,'fictional',1,6,25,121,9,1,1.5)`).run();
    const result = await cloud.holdRows('fictional', 1000000, null);
    expect(result.rows.map(row => [row.source, row.speed_kmh])).toEqual([['ble', 0.4], ['cloud', 1.5]]);
  } finally { db.close(); }
});
