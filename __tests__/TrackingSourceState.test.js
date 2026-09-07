import {
  createTrackingSourceState,
  trackingSourceReducer,
} from '../src/tracking/TrackingSourceState';

const row = (id, receivedAt = id * 1000, changes = {}) => ({
  id,
  receivedAt,
  masterId: 3,
  slaveId: 7,
  masterLat: 25,
  masterLon: 121,
  slaveLat: 25 + id / 10000,
  slaveLon: 121,
  ...changes,
});

const reduce = (state, type, values = {}) =>
  trackingSourceReducer(state, { type, source: 'real', ...values });

test('source reducer accepts a display snapshot without rewinding latest status', () => {
  let state = createTrackingSourceState();
  state = reduce(state, 'latest', { point: row(10) });
  const route = { ...state.real.route, rawCount: 86401 };
  state = reduce(state, 'route', { route });
  state = reduce(state, 'rows', {
    rows: [row(3), row(4), row(5), row(6)],
  });

  expect(state.real.point.id).toBe(10);
  expect(state.real.route).toBe(route);
  expect(state.real.positionSamples).toHaveLength(1);
});

test('reset clears only one source while preserving its initialized state', () => {
  let state = createTrackingSourceState();
  state = reduce(state, 'ready');
  state = reduce(state, 'initial-snapshot-ready');
  state = reduce(state, 'history-loaded');
  state = reduce(state, 'rows', { rows: [row(1)] });
  const untouchedDemo = state.demo;

  state = reduce(state, 'reset-source');

  expect(state.real).toMatchObject({
    ready: true,
    initialSnapshotReady: false,
    historyLoaded: false,
    route: { rawCount: 0, masterSegments: [], slaveSegments: [] },
  });
  expect(state.demo).toBe(untouchedDemo);
});

test('backfill from another device never replaces the current device fallback', () => {
  let state = createTrackingSourceState();
  state = reduce(state, 'latest', {
    point: row(10, 10000, { slaveLat: null }),
  });
  state = reduce(state, 'position-context', { rows: [row(2)] });
  state = reduce(state, 'rows', { rows: [row(5, 5000, { slaveId: 99 })] });
  const slaveFallback = state.real.positionSamples.find(
    sample => sample.slave && sample.slaveId === 7,
  );
  expect(slaveFallback.id).toBe(2);
  expect(state.real.point.id).toBe(10);
});
