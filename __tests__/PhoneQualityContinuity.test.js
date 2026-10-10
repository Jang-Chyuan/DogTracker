import { historyStops, historyVisits } from '../src/history/HistoryStops';
import { historyMovement } from '../src/history/HistoryMovement';

const origin = { latitude: 24.9892, longitude: 121.3132 };
const row = (seconds, metres, extra = {}) => {
  const p = { ...origin, longitude: origin.longitude + metres / (111320 * Math.cos(origin.latitude * Math.PI / 180)),
    time: seconds * 1000, accuracy: 20, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4,
    phoneMotionState: 'stationary', phoneStationary: true, phoneConfirmedMovement: false,
    session_id: 'anonymous-session', slave_id: 'phone', ...extra };
  return { ...p, raw_latitude: p.latitude, raw_longitude: p.longitude };
};
const uncertain = { raw_speed_kmh: 3.6, speed_kmh: 3.6, speed_accuracy_mps: 5,
  phoneMotionState: 'unknown', phoneStationary: false };
function fixture() {
  // Previously judged anchor differs from its retained raw observations;
  // the uncertainty rule must use raw continuity, not this display offset.
  return [...[0, 300, 600, 900, 1200, 1500].map(t => ({ ...row(t, 0),
    raw_longitude: row(t, 100).longitude })),
    row(1775, 100, { ...uncertain, raw_speed_kmh: 0, speed_kmh: 0 }),
    row(1800, 100, { ...uncertain, raw_speed_kmh: 0, speed_kmh: 0 }),
    ...[1810, 1820, 1835].map(t => row(t, 140, uncertain)),
    ...[1840, 1850, 1865, 1875].map(t => row(t, 90, uncertain)),
    ...[1900, 1910, 1925].map(t => row(t, 120, uncertain)),
    ...[1930, 2100, 2400, 2700, 3000, 3300, 3600, 3900].map(t => row(t, 120))];
}
const visits = (points, options = {}) => historyVisits(points, { subject: 'phone', ...options });

test('continuous quality uncertainty between confirmed long visits reconciles short fragments without changing raw movement', () => {
  const points = fixture(), snapshot = JSON.stringify(points);
  const result = visits(points);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ start: 0, end: 3900000, durationMs: 3900000,
    inferredQualityIntervals: [{ start: 1800000, end: 1900000, confirmedAt: 1930000 }] });
  expect(JSON.stringify(points)).toBe(snapshot);
  const movement = historyMovement(points, { subject: 'phone' });
  expect(movement.edges.some(e => e.uncertain && e.start >= 1800000 && e.end <= 1900000)).toBe(true);
  expect(movement.distanceM).toBe(0);
});

test.each(['positive proof', 'credible walking', 'moving state', 'session change', 'recording gap',
  'sample interruption', 'missing confirmation', 'invalid quality', 'missing raw', 'wrong-zero real departure'])(
  'quality continuity cannot swallow %s', failure => {
    const points = fixture();
    const middle = points.find(p => p.time === 1840000);
    if (failure === 'positive proof') middle.phoneConfirmedMovement = true;
    if (failure === 'credible walking') middle.speed_accuracy_mps = 0.4;
    if (failure === 'moving state') middle.phoneMotionState = 'moving';
    if (failure === 'session change') points.filter(p => p.time >= middle.time).forEach(p => { p.session_id = 'next-session'; });
    if (failure === 'recording gap') points.filter(p => p.time >= 1900000).forEach(p => { p.time += 300000; });
    if (failure === 'sample interruption') points.splice(points.findIndex(p => p.time === 1840000), 4);
    if (failure === 'missing confirmation') points.forEach(p => { if (p.time >= 1900000) p.phoneStationary = false; });
    if (failure === 'invalid quality') middle.accuracy = NaN;
    if (failure === 'missing raw') middle.raw_latitude = null;
    if (failure === 'wrong-zero real departure') points.filter(p => p.time >= 1900000).forEach(p => {
      p.raw_longitude = row(0, 160).longitude;
    });
    expect(visits(points).length).toBeGreaterThan(1);
  });

test('a vehicle in the uncertain interval remains excluded from visits', () => {
  expect(visits(fixture(), { vehicles: [{ start: 1810000, end: 1930000 }] }).length).toBeGreaterThan(1);
});

test('an unresolved final visit and late detector confirmation cannot retroactively join a quality interval', () => {
  const points = fixture();
  points.forEach(p => { if (p.time >= 1900000 && p.time < 2100000) p.phoneStationary = false; });
  expect(visits(points).length).toBeGreaterThan(1);
  expect(visits(fixture().filter(p => p.time <= 2000000)).length).toBeGreaterThan(1);
});

test('movement during the confirmation horizon and an excursion outside the finite quality footprint cannot merge', () => {
  const moving = fixture();
  Object.assign(moving.find(p => p.time === 1925000), { phoneMotionState: 'moving' });
  expect(visits(moving).length).toBeGreaterThan(1);
  const excursion = fixture();
  excursion.find(p => p.time === 1840000).raw_longitude = row(0, 200).longitude;
  expect(visits(excursion).length).toBeGreaterThan(1);
});

test('a reliable zero-speed re-entry transition can recover, but missing speed cannot excuse moving', () => {
  const points = fixture();
  Object.assign(points.find(p => p.time === 1925000), { phoneMotionState: 'moving',
    raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4 });
  expect(visits(points)).toHaveLength(1);
  points.find(p => p.time === 1925000).raw_speed_kmh = null;
  expect(visits(points).length).toBeGreaterThan(1);
});

test('range clipping does not carry quality continuity from outside the selected fixes', () => {
  const points = fixture();
  expect(historyStops(points, { subject: 'phone', start: 0, end: 1800000 }).visits[0].inferredQualityIntervals).toEqual([]);
  expect(historyStops(points, { subject: 'phone', start: 1930000, end: 3900000 }).visits[0].inferredQualityIntervals).toEqual([]);
  expect(historyStops(points, { subject: 'phone', start: 0, end: 3900000 }).visits[0].inferredQualityIntervals)
    .toHaveLength(1);
});

