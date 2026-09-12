import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import {
  projectRoutePoint,
  squaredSegmentDistance,
} from '../src/tracking/SimplifyRoute';

const row = (id, changes = {}) => ({
  id,
  receivedAt: id * 1000,
  masterId: 1,
  slaveId: 2,
  masterLat: 25,
  masterLon: 121 + id / 100000,
  slaveLat: 25.001,
  slaveLon: 121 + id / 100000,
  ...changes,
});
const rows = (start, count) =>
  Array.from({ length: count }, (_, i) => row(start + i));

test('an empty or untruncated window is never limited before a cutoff exists', () => {
  const window = createLiveRouteWindow();
  expect(window.isLimited()).toBe(false);
  expect(window.snapshot()).toMatchObject({ rawCount: 0, limited: false });
  window.append(rows(1, 3));
  expect(window.isLimited()).toBe(false);
  expect(window.snapshot()).toMatchObject({ rawCount: 3, limited: false });
  window.reset();
  expect(window.isLimited()).toBe(false);
  expect(window.snapshot()).toMatchObject({ rawCount: 0, limited: false });
});

test('only actual budget omissions inside the window count as limited', async () => {
  const window = createLiveRouteWindow({ maxPoints: 4, chunkSize: 2 });
  window.append(rows(1, 6));
  expect(window.isLimited()).toBe(true);
  expect(window.snapshot().limited).toBe(true);
  await window.advanceCutoff(2000, jest.fn());
  expect(window.snapshot().limited).toBe(true);
  await window.advanceCutoff(2001, jest.fn());
  expect(window.isLimited()).toBe(false);
  expect(window.snapshot().limited).toBe(false);
  window.append(rows(7, 2));
  expect(window.snapshot().limited).toBe(true);
  window.reset();
  expect(window.isLimited()).toBe(false);
  expect(window.snapshot()).toMatchObject({ rawCount: 0, limited: false });
});

test('descending history pages join, deduplicate retries, and keep snapshots immutable', () => {
  const window = createLiveRouteWindow({ chunkSize: 4 });
  window.prepend(rows(5, 4).reverse());
  const before = window.snapshot();
  window.prepend(rows(1, 4).reverse());
  window.prepend(rows(1, 4).reverse());
  const snapshot = window.snapshot();
  expect(snapshot.rawCount).toBe(8);
  expect(snapshot.slaveSegments).toHaveLength(1);
  expect(snapshot.slaveSegments[0]).toHaveLength(4);
  expect(before.rawCount).toBe(4);
  expect(window.snapshot()).toBe(snapshot);
});

test.each(['master', 'slave'])(
  '%s missing coordinates and device changes break routes across pages',
  role => {
    const window = createLiveRouteWindow({ chunkSize: 3 });
    window.prepend(rows(4, 3));
    window.prepend([row(1), row(2), row(3, { [`${role}Lat`]: null })]);
    window.append([row(7, { [`${role}Id`]: 9 }), row(8, { [`${role}Id`]: 9 })]);
    const segments = window.snapshot()[`${role}Segments`];
    expect(segments).toHaveLength(3);
    expect(segments.map(segment => segment.length)).toEqual([2, 2, 2]);
  },
);

test('rolling cutoff rereads original boundary data, never trims an already-simplified line', async () => {
  const window = createLiveRouteWindow({ chunkSize: 4 });
  for (const first of [9, 5, 1]) window.prepend(rows(first, 4));
  const read = jest.fn(async chunk => rows(chunk.first.id, chunk.count));
  await window.advanceCutoff(6000, read);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][0].raw).toBeNull();
  expect(window.snapshot()).toMatchObject({
    rawCount: 7,
    startAt: 6000,
    endAt: 12000,
  });
  expect(window.snapshot().slaveSegments[0][0].longitude).toBe(row(6).slaveLon);
});

test('boundary DB errors and cancelled reads leave the previously published route intact', async () => {
  const window = createLiveRouteWindow({ chunkSize: 4 });
  for (const first of [9, 5, 1]) window.prepend(rows(first, 4));
  const before = window.snapshot();
  await expect(
    window.advanceCutoff(6000, async () => {
      throw new Error('locked');
    }),
  ).rejects.toThrow('locked');
  expect(window.snapshot()).toBe(before);
  expect(
    await window.advanceCutoff(
      6000,
      async () => rows(5, 4),
      () => false,
    ),
  ).toBe(false);
  expect(window.snapshot()).toBe(before);
  await window.advanceCutoff(6000, async () => rows(5, 4));
  expect(window.snapshot().startAt).toBe(6000);
});

test('late timestamps request a rebuild without inserting into a compressed segment', () => {
  const window = createLiveRouteWindow();
  window.append(rows(1, 5));
  const before = window.snapshot();
  expect(window.append([row(6, { receivedAt: 2500 })])).toBe(false);
  expect(window.snapshot()).toBe(before);
});

test('noise exceeding 1 m keeps a bounded newer route and declares truncation', () => {
  const window = createLiveRouteWindow({ maxPoints: 50, chunkSize: 20 });
  for (let page = 9; page >= 0; page -= 1)
    window.prepend(
      rows(page * 20 + 1, 20).map(item => ({
        ...item,
        slaveLat: 25 + (item.id % 2) / 1000,
      })),
    );
  expect(window.snapshot().limited).toBe(true);
  expect(window.snapshot().slavePointCount).toBeLessThanOrEqual(50);
  expect(window.snapshot().endAt).toBe(200000);
  expect(window.snapshot().rawBufferCount).toBeLessThanOrEqual(40);
});

test('all-missing GPS still has a finite chunk metadata budget', () => {
  const window = createLiveRouteWindow({ maxPoints: 10, chunkSize: 2 });
  for (let page = 0; page < 100; page += 1)
    window.append(
      rows(page * 2 + 1, 2).map(item => ({
        ...item,
        masterLat: null,
        slaveLat: null,
      })),
    );
  expect(window.snapshot()).toMatchObject({
    rawCount: 10,
    limited: true,
    masterPointCount: 0,
    slavePointCount: 0,
  });
  expect(window.snapshot().rawBufferCount).toBeLessThanOrEqual(4);
});

test.each([
  { chunkSize: 0 },
  { chunkSize: 1001 },
  { chunkSize: NaN },
  { maxPoints: Infinity },
  { maxPoints: -1 },
  { toleranceMeters: Infinity },
])(
  'invalid route limits fail early rather than looping or growing unbounded: %p',
  options => {
    expect(() => createLiveRouteWindow(options)).toThrow(RangeError);
  },
);

test('page joins, repeated live updates and cutoff rebuilds still respect 1 m against raw data', async () => {
  const raw = rows(1, 4019).map(item => ({
    ...item,
    slaveLat:
      25 + 0.0001 * Math.sin(item.id / 11) + 0.000007 * Math.sin(item.id * 0.7),
  }));
  const window = createLiveRouteWindow({ chunkSize: 100 });
  for (let i = 3900; i >= 0; i -= 100) window.prepend(raw.slice(i, i + 100));
  for (const item of raw.slice(4000)) window.append([item]);
  await window.advanceCutoff(3511000, async chunk =>
    raw.filter(item => item.id >= chunk.first.id && item.id <= chunk.last.id),
  );
  const inside = raw.filter(item => item.receivedAt >= 3511000);
  const selected = window.snapshot().slaveSegments[0];
  expect(selected[0].longitude).toBe(inside[0].slaveLon);
  expect(selected.at(-1).longitude).toBe(inside.at(-1).slaveLon);
  let cursor = 0;
  for (let i = 1; i < selected.length; i += 1) {
    const end = inside.findIndex(
      item => item.slaveLon === selected[i].longitude,
    );
    expect(end).toBeGreaterThan(cursor);
    for (let index = cursor; index <= end; index += 1) {
      const point = {
        latitude: inside[index].slaveLat,
        longitude: inside[index].slaveLon,
      };
      expect(
        squaredSegmentDistance(
          projectRoutePoint(point),
          projectRoutePoint(selected[i - 1]),
          projectRoutePoint(selected[i]),
        ),
      ).toBeLessThanOrEqual(1.000001);
    }
    cursor = end;
  }
});
