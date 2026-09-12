import {
  projectRoutePoint,
  simplifyRoute,
} from '../src/tracking/SimplifyRoute';

const xy = (x, y) => ({
  latitude: 25 + y / 111320,
  longitude: 121 + x / 100000,
});

// Independent distance calculation, checking each original vertex against its
// own retained interval rather than any nearby part of a self-crossing route.
export function maximumError(raw, selected) {
  let maximum = 0;
  let start = 0;
  for (let index = 1; index < selected.length; index += 1) {
    const end = raw.indexOf(selected[index], start + 1);
    if (end < 0) throw new Error('selected endpoint not found in raw order');
    const a = projectRoutePoint(raw[start]);
    const b = projectRoutePoint(raw[end]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    for (let i = start; i <= end; i += 1) {
      const p = projectRoutePoint(raw[i]);
      const along = length
        ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length
        : -1;
      const distance =
        along < 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : along > length
          ? Math.hypot(p.x - b.x, p.y - b.y)
          : Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
      maximum = Math.max(maximum, distance);
    }
    start = end;
  }
  return maximum;
}

test.each([0, 0.01, 0.5, 2, 20])(
  '1 m bound and endpoints hold with %s m oscillations',
  noise => {
    const raw = Array.from({ length: 1000 }, (_, i) =>
      xy(i, 50 * Math.sin(i / 70) + noise * Math.sin(i * 0.7)),
    );
    const before = JSON.stringify(raw);
    const selected = simplifyRoute(raw, 1);
    expect(selected[0]).toBe(raw[0]);
    expect(selected.at(-1)).toBe(raw.at(-1));
    expect(maximumError(raw, selected)).toBeLessThanOrEqual(1.000001);
    expect(JSON.stringify(raw)).toBe(before);
  },
);

test('closed loops, repeated coordinates, empty input and a straight path are safe', () => {
  const loop = [xy(0, 0), xy(0, 0), xy(100, 0), xy(100, 100), xy(0, 0)];
  expect(simplifyRoute(loop)).toEqual([loop[0], ...loop.slice(2)]);
  expect(simplifyRoute([])).toEqual([]);
  expect(simplifyRoute([xy(0, 0), xy(1, 0), xy(2, 0)])).toHaveLength(2);
  expect(simplifyRoute([xy(0, 0), xy(0, 0), xy(0, 0)])).toHaveLength(2);
});

test('dateline, polar and disabled-tolerance cases preserve raw coordinates', () => {
  const dateline = [
    { latitude: 0, longitude: 179.9 },
    { latitude: 0, longitude: -179.9 },
    { latitude: 0, longitude: -179 },
  ];
  const polar = [86, 87, 88].map(latitude => ({ latitude, longitude: 0 }));
  expect(simplifyRoute(dateline)).toBe(dateline);
  expect(simplifyRoute(polar)).toBe(polar);
  for (const tolerance of [0, -1, NaN, Infinity])
    expect(simplifyRoute(dateline, tolerance)).toBe(dateline);
});
