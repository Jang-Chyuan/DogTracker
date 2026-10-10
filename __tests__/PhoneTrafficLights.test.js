import fixtures from '../__fixtures__/PhoneTrafficLights';
import { historyMovement } from '../src/history/HistoryMovement';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';

// Independently invented, regular five-second phases (79 fixture points).
// Coordinates are generated from speed × time; no recorded route is sampled,
// shifted or rotated. Columns: dt,x/y display,x/y raw,accuracy,raw km/h,SACC,km/h.
const adapt = values => values.map(([dt, y, x, rawY, rawX, accuracy, rawSpeed, sacc, speed]) =>
  phoneHistoryRow({ time: 0 + dt, latitude: 24.989 + y / 111195,
    longitude: 121.313 + x / (111195 * Math.cos(24.989 * Math.PI / 180)),
    raw_latitude: 24.989 + rawY / 111195,
    raw_longitude: 121.313 + rawX / (111195 * Math.cos(24.989 * Math.PI / 180)),
    accuracy, raw_speed_kmh: rawSpeed, speed_accuracy_mps: sacc, speed_kmh: speed,
    session_id: 'invented-traffic' }));
const timeline = points => historyTimeline(points, { subject: 'phone', today: false,
  range: { start: points[0].time, end: points.at(-1).time } });
// Each designed light starts inside an already confirmed vehicle trip.
// Eight further invented high-speed observations provide that context.
const drivingContext = points => {
  const first = points[0];
  return [...Array.from({ length: 8 }, (_, i) => phoneHistoryRow({
    time: first.time - (8 - i) * 5000, latitude: first.latitude - (8 - i) * 40 / 111195,
    longitude: first.longitude, accuracy: 8, raw_speed_kmh: 28.8, speed_accuracy_mps: 0.1,
    session_id: 'invented-traffic' })), ...points];
};
const route = phases => {
  let time = 0, metres = 0;
  const make = speed => ({ time, latitude: 24.989 + metres / 111195, longitude: 121.313,
    raw_latitude: 24.989 + metres / 111195, raw_longitude: 121.313,
    accuracy: 8, raw_speed_kmh: speed * 3.6, speed_accuracy_mps: 0.1,
    phoneMotionState: speed ? 'moving' : 'stationary', phoneStationary: !speed,
    phoneConfirmedMovement: !!speed });
  const points = [make(phases[0][0])];
  for (const [speed, seconds] of phases) for (let t = 0; t < seconds; t += 5) {
    time += 5000; metres += speed * 5; points.push(make(speed));
  }
  return points;
};

test('invented traffic light retains vehicle context without false walking switches', () => {
  const model = timeline(drivingContext(adapt(fixtures.trafficLights)));
  expect(model.edges.every(e => e.mode === 'driving')).toBe(true);
  expect(model.nodes.filter(n => n.type === 'switch' || n.type === 'stop')).toHaveLength(0);
  expect(model.distanceM).toBe(0);
});
test('invented terminal light resumes driving despite short high-speed runs', () => {
  const model = timeline(drivingContext(adapt(fixtures.terminalParking)));
  expect(model.nodes.filter(n => n.type === 'movement').every(n => n.mode === 'driving')).toBe(true);
  expect(model.distanceM).toBe(0);
});
test('stationary traffic light followed by a slow car stays driving', () => {
  const model = historyMovement(route([[8, 40], [0, 90], [3.5, 120], [8, 40]]), { subject: 'phone' });
  expect(model.vehicles).toHaveLength(1);
  expect(model.edges.every(e => e.mode === 'driving')).toBe(true);
});
test('a real short walk after getting out is retained, even if driving resumes', () => {
  const model = historyMovement(route([[8, 40], [0, 60], [1.4, 15], [8, 40]]), { subject: 'phone' });
  expect(model.vehicles).toHaveLength(2);
  expect(model.edges.some(e => e.mode === 'walking' && e.countedDistanceM > 0)).toBe(true);
  expect(model.distanceM).toBeGreaterThan(10);
});
test('confirmed stationary parking ends vehicle context instead of swallowing an indoor day', () => {
  const model = historyMovement(route([[8, 40], [0, 600]]), { subject: 'phone' });
  expect(model.vehicles).toHaveLength(1);
  expect(model.vehicles[0].end).toBe(40000);
  expect(model.edges.at(-1).mode).toBe('walking');
  expect(model.distanceM).toBe(0);
});
test('missing-speed confirmed walking still releases vehicle context', () => {
  const points = route([[8, 40], [1.4, 40]]);
  for (const p of points.slice(9)) {
    p.raw_speed_kmh = null; p.phoneDepartureSince = points[8].time;
  }
  const model = historyMovement(points, { subject: 'phone' });
  expect(model.edges.at(-1).mode).toBe('walking');
  expect(model.distanceM).toBeGreaterThan(30);
});

test('a five-minute red light and slow launch do not commit a false exit', () => {
  const model = historyMovement(route([[8, 40], [0, 300], [3.5, 45], [8, 40]]), { subject: 'phone' });
  expect(model.vehicles).toHaveLength(1);
  expect(model.edges.every(e => e.mode === 'driving')).toBe(true);
});
test('invented fixture prefix appends agree with batch today distance through parked backfills', () => {
  const cases = [...Object.values(fixtures).map(values => drivingContext(adapt(values))),
    route([[8, 40], [0, 300], [3.5, 45], [8, 40]]),
    route([[8, 40], [0, 60], [1.4, 15], [8, 40]]),
    route([[8, 40], [0, 600]]),
    route([[8, 40], [3.5, 60], [0, 600]]),
    route([[8, 40], [3.5, 60], [0, 1900]])];
  for (const rows of cases) {
    const dayStart = rows[0].time - 60000;
    const engine = createTodayRouteEngine({ dayStart });
    for (let i = 0; i < rows.length; i += 25) {
      const prefix = rows.slice(0, Math.min(i + 25, rows.length));
      engine.add(prefix.slice(i));
      const now = prefix.at(-1).time;
      expect(engine.sum(now).metres).toBeCloseTo(todayRouteDistance(prefix, { now, dayStart }).metres, 6);
    }
  }
});

test('missing speed cannot reuse stale driving proof as a walking departure', () => {
  const points = route([[8, 40], [2, 15], [8, 40]]);
  for (const p of points.slice(9, 12)) {
    p.raw_speed_kmh = null; p.phoneDepartureSince = points[0].time;
  }
  const model = historyMovement(points, { subject: 'phone' });
  expect(model.edges.every(e => e.mode === 'driving')).toBe(true);
});

test('a fast data gap clears pending foot/park clocks without inventing a terminal stop', () => {
  const points = route([[8, 40], [0, 60]]), last = points.at(-1);
  points.push({ ...last, time: last.time + 300000,
    latitude: last.latitude + 2000 / 111195, raw_latitude: last.raw_latitude + 2000 / 111195,
    raw_speed_kmh: 24, phoneStationary: false, phoneMotionState: 'moving' });
  const model = historyMovement(points, { subject: 'phone' });
  expect(model.edges.at(-1).mode).toBe('gap');
  expect(model.vehicles[0].end).toBe(points.at(-1).time);
});

test('terminal parking does not backfill the preceding slow-car approach as walking', () => {
  const model = historyMovement(route([[8, 40], [3.5, 60], [0, 600]]), { subject: 'phone' });
  expect(model.vehicles[0].end).toBe(100000);
  expect(model.distanceM).toBe(0);
});

test('bounded long parking also preserves the preceding slow-car approach', () => {
  const model = historyMovement(route([[8, 40], [3.5, 60], [0, 1900]]), { subject: 'phone' });
  expect(model.vehicles[0].end).toBe(100000);
  expect(model.distanceM).toBe(0);
});

test('legacy phone fixes keep the original low-speed exit boundary', () => {
  const rows = route([[8, 40], [3.5, 60], [0, 600]]);
  for (const row of rows) {
    delete row.phoneMotionState; delete row.phoneStationary; delete row.phoneConfirmedMovement;
  }
  const model = historyMovement(rows, { subject: 'phone' });
  expect(model.vehicles[0].end).toBe(40000);
  expect(model.distanceM).toBeGreaterThan(0);
});

test('raw zero speed alone cannot backdate a confirmed parking boundary', () => {
  const rows = route([[8, 40], [3.5, 60], [0, 600]]);
  for (const row of rows) if (row.time > 100000 && row.time <= 160000) {
    row.phoneStationary = false; row.phoneMotionState = 'moving';
  }
  const model = historyMovement(rows, { subject: 'phone' });
  expect(model.vehicles[0].end).toBe(160000);
  expect(model.distanceM).toBe(0);
});

test('production-decorated geometry-only rows retain legacy car-to-foot exit', () => {
  const rows = route([[8, 40], [1.4, 30]]).map(({ time, latitude, longitude, accuracy }) =>
    ({ time, latitude, longitude, accuracy }));
  const model = timeline(rows);
  expect(model.points.every(p => p.phoneMotionState != null)).toBe(true);
  expect(model.nodes.some(n => n.type === 'switch')).toBe(true);
  expect(model.edges.at(-1).mode).toBe('walking');
  expect(model.distanceM).toBeGreaterThan(35);
});
