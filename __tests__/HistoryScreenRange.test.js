import { screenRange, dragRange, reconcileRange, rangeBar, rangeMemoryKey, nearestRecord, rememberRange } from '../src/history/screen';
const points = [0, 60000, 120000, 180000].map(time => ({ time }));
const departure = { automaticRange: { start: 60000, end: 180000 }, status: 'confirmed' };
const options = { today: true, now: 240000, departure };
test('automatic starts at departure, follows now; past/closed use last fix', () => {
  expect(screenRange(points, options)).toMatchObject({ start: 60000, end: 240000, lastRecord: 180000, following: true });
  expect(screenRange(points, { ...options, today: false })).toMatchObject({ end: 180000, following: false });
  expect(screenRange(points, { ...options, closedAt: 200000 }).following).toBe(false);
  expect(screenRange(points, { ...options, dayEnd: 210000 }).end).toBe(209999);
});
test('manual start keeps following; fixed end and right-edge restore remain manual', () => {
  const a = dragRange(screenRange(points, options), points, 'start', 120000).range;
  expect(a).toMatchObject({ manual: true, following: true, start: 120000 });
  const b = dragRange(a, points, 'end', 180000, { today: true, rightEdge: 240000 }).range;
  expect(b).toMatchObject({ manual: true, following: false, end: 180000 });
  expect(dragRange(b, points, 'end', 240000, { today: true, rightEdge: 240000 }).range).toMatchObject({ manual: true, following: true, end: 240000 });
  expect(screenRange(points, { ...options, manual: a, now: 300000 }).end).toBe(300000);
});
test.each([180000, 240000])('invalid drag %s bounces, never resets manual', time => {
  const range = screenRange(points, options);
  expect(dragRange(range, points, 'start', time)).toEqual({ range, haptics: ['double'] });
});
test('reconciliation snaps inward; invalidated manual alone resets to automatic', () => {
  expect(reconcileRange({ start: 61000, end: 179000, following: false }, points, options)).toMatchObject({ start: 60000, end: 120000, manual: true });
  expect(reconcileRange({ start: 120000, end: 121000 }, points, options)).toMatchObject({ manual: false, start: 60000 });
  expect(reconcileRange({ start: 60000, following: true }, points, options).following).toBe(true);
  expect(reconcileRange({ start: 60000, end: 180000 }, [], options).manual).toBe(false);
});
test('short record sets disable handles, empty range is safe, equal snap picks earlier', () => {
  expect(screenRange([{ time: 0 }], options).enabled).toBe(false);
  const range = screenRange([{ time: 0 }], options);
  expect(dragRange(range, points, 'end', 120000)).toEqual({ range, haptics: [] });
  expect(screenRange([], { now: 0 }).start).toBe(null);
  expect(nearestRecord(points, 90000).time).toBe(60000);
});
test('bar only closes on explicit actions and entry/source/timezone keys differ', () => {
  let range = rangeBar(screenRange(points, options), 'summary');
  expect(range.expanded).toBe(true);
  expect(rangeBar(range, 'route')).toBe(range);
  for (const action of ['done', 'map-blank', 'list', 'panel-drag', 'back']) expect(rangeBar(range, action).expanded).toBe(false);
  range = rangeBar(range, 'summary');
  expect(range.expanded).toBe(false);
  expect(rangeMemoryKey('dog', '2026-10-03', 'all', 'Asia/Taipei')).not.toBe(rangeMemoryKey('dog', '2026-10-03', 'cloud', 'Asia/Taipei'));
});
test('manual following expires on past days or closed recording at last observation', () => {
  const manual = { start: 60000, end: 240000, following: true };
  expect(screenRange(points, { ...options, manual, today: false })).toMatchObject({ manual: true, end: 180000, following: false });
  expect(screenRange(points, { ...options, manual, closedAt: 200000 }).end).toBe(180000);
});

test('remember only last manual range per key; reconciliation can delete that key', () => {
  const old = { other: { start: 0 } };
  const range = { manual: true, start: 60000, end: 240000, following: true };
  const memory = rememberRange(old, 'entry-day', range);
  expect(memory['entry-day']).toEqual({ start: 60000, end: 240000, following: true });
  expect(rememberRange(memory, 'entry-day', { manual: false })).toEqual(old);
  expect(old).not.toHaveProperty('entry-day');
});
