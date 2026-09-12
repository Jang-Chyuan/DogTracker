import { buildSegments, latestPosition } from '../src/map/TrackingGeometry';
import {
  coordinate,
  mergePositionSamples,
  toRouteSample,
  selectStatusRows,
} from '../src/tracking/RouteSamples';
const row = (id, changes = {}) => ({
  id,
  receivedAt: id * 1000,
  masterId: 1,
  slaveId: 2,
  masterLat: 25,
  masterLon: 121,
  slaveLat: 25 + id / 1000,
  slaveLon: 121,
  ...changes,
});
test.each([
  [null, 121],
  [25, undefined],
  ['25', 121],
  [NaN, 121],
  [Infinity, 0],
  [91, 0],
  [0, -181],
])('rejects invalid coordinate %p, %p', (lat, lon) =>
  expect(coordinate(lat, lon)).toBeNull(),
);
test('accepts zero and exact geographic bounds', () => {
  expect(coordinate(0, 0)).toEqual({ latitude: 0, longitude: 0 });
  expect(coordinate(-90, 180)).not.toBeNull();
});
test('route samples retain geometry, not payloads; status queues at most three rows', () => {
  expect(toRouteSample(row(1, { rawPayload: 'unused' }))).not.toHaveProperty(
    'rawPayload',
  );
  const selected = selectStatusRows([
    ...Array.from({ length: 1000 }, (_, i) => row(i)),
    row(1000, { masterLat: null }),
    row(1001, { slaveLat: null }),
    row(1002, { masterLat: null, slaveLat: null }),
  ]);
  expect(selected.map(point => point.id)).toEqual([1000, 1001, 1002]);
});
test('marker context stays bounded to the latest valid sample per endpoint', () => {
  const context = mergePositionSamples(
    [],
    [
      row(1),
      row(2, { masterLat: null }),
      row(3, { slaveLat: null }),
      row(4, { masterLat: null, slaveLat: null }),
    ],
  );
  expect(context.map(sample => sample.id)).toEqual([2, 3]);
  expect(context).toHaveLength(2);
});
test('status selection keeps the current devices when a batch switches away and back', () => {
  const rows = [
    row(10),
    row(11, { masterId: 9, slaveId: 9 }),
    row(12, { masterLat: null, slaveLat: null }),
  ];
  const selected = selectStatusRows(rows);
  expect(selected.map(point => point.id)).toEqual([10, 12]);
  const context = mergePositionSamples([], selected, rows[2]);
  for (const role of ['master', 'slave']) {
    expect(latestPosition(rows[2], context, role, true)).toEqual({
      coordinate: toRouteSample(rows[0])[role],
      receivedAt: rows[0].receivedAt,
      retained: true,
    });
  }
});
test('missing coordinates introduce gaps instead of connecting across them', () => {
  const samples = [
    row(1),
    row(2),
    row(3, { slaveLat: null }),
    row(4),
    row(5),
  ].map(toRouteSample);
  expect(
    buildSegments(samples, 'slave').map(segment => segment.length),
  ).toEqual([2, 2]);
  expect(buildSegments(samples, 'master')).toEqual([]); // stationary duplicates
});
test('does not connect different device IDs', () => {
  const samples = [
    row(1),
    row(2),
    row(3, { slaveId: 3 }),
    row(4, { slaveId: 3 }),
  ].map(toRouteSample);
  expect(buildSegments(samples, 'slave')).toHaveLength(2);
});
test('retains the last valid position by row ID only for the same device', () => {
  const samples = [
    row(1, { receivedAt: 9000 }),
    row(2),
    row(3, { slaveLat: null }),
  ].map(toRouteSample);
  const position = latestPosition(
    row(3, { slaveLat: null }),
    samples,
    'slave',
    true,
  );
  expect(position).toEqual({
    coordinate: coordinate(25.002, 121),
    receivedAt: 2000,
    retained: true,
  });
  expect(
    latestPosition(
      row(3, { slaveLat: null, slaveId: 7 }),
      samples,
      'slave',
      true,
    ),
  ).toBeNull();
  expect(
    latestPosition(row(3, { slaveLat: null }), samples, 'slave', false),
  ).toBeNull();
});
test('valid latest coordinate takes precedence; an empty source never borrows another source', () => {
  expect(latestPosition(row(2), [], 'slave', true).retained).toBe(false);
  expect(latestPosition({ id: null }, [], 'slave', true)).toBeNull();
});
