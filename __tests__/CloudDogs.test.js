import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MapView, { Marker } from 'react-native-maps';
import { Platform } from 'react-native';
import NativePlatform from '../specs/NativeTrackingPlatform';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { POLL_MS, useCloudDogs } from '../src/cloud/useCloudDogs';
import { MAX_AGE_MS, mergeDogMarkers } from '../src/map/DogMerge';
import MapScreen from '../src/screens/MapScreen';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';

const NOW = trackingPoint.receivedAt + 60000;
const row = (eventId, slaveId, receivedAt, masterId, extra = {}) => ({
  event_id: eventId, slave_id: slaveId, master_id: masterId, received_at: receivedAt,
  slave_lat: 25.1, slave_lon: 121.6, activity_valid: 0, battery_valid: 0, ...extra,
});

test('status reads retain local fixes and new no-fix packets, and use corrected cloud time', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await connection.executeAsync(`INSERT INTO dog_status
      (slave_id, master_id, received_at, slave_lat, slave_lon, battery_percentage)
      VALUES (4, 5, ?, 25, 121, 80), (4, 5, ?, 0, 0, 70), (6, 5, ?, 25, 121, 60)`,
    [NOW - 121000, NOW, NOW]);
    await database.savePage('a', [row('delayed', 8, NOW, 5, { track_at: NOW - 3600000 })]);
    await database.savePage('b', [row('other-account', 9, NOW, 7)]);
    const packets = await database.latestStatusRows('a', String(NOW - MAX_AGE_MS));
    expect(packets.some(p => p.slave_id === 9)).toBe(false);
    const dogs = mergeDogMarkers({ point: null, packetRows: packets, now: NOW, windowMs: 120000 });
    expect(dogs.find(d => d.slaveId === 4)).toMatchObject({
      stale: true, lastPositionAt: NOW - 121000, lastPacketAt: NOW,
      communicationStatus: '有通訊／GPS 未定位',
    });
    expect(dogs.find(d => d.slaveId === 6).stale).toBe(false);
    expect(dogs.find(d => d.slaveId === 8)).toMatchObject({ stale: true, lastPacketAt: NOW - 3600000 });
  } finally { connection.close(); }
});

test('live positions use corrected time for selection and expiry while retaining ingestion time', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage('a', [
      row('wifi', 4, NOW - 1000, 7),
      row('late-phone', 4, NOW, 5, { track_at: NOW - 3600000, slave_lat: 26 }),
      row('stale-phone', 8, NOW, 5, { track_at: NOW - 3600000 }),
      row('expired-phone', 6, NOW, 5, { track_at: NOW - MAX_AGE_MS - 1 }),
    ]);
    // Android rawQuery binds range parameters as strings.
    const found = await database.latestBySlave('a', String(NOW - MAX_AGE_MS));
    expect(found.map(r => r.slave_id)).toEqual([4, 8]);
    expect(found[0]).toMatchObject({ master_id: 7, slave_lat: 25.1, track_at: NOW - 1000 });
    expect(found[1]).toMatchObject({ received_at: NOW, track_at: NOW - 3600000 });
    const dogs = mergeDogMarkers({ cloudRows: found, now: NOW, windowMs: 600000 });
    expect(dogs[0].stale).toBe(false);
    expect(dogs[1]).toMatchObject({ receivedAt: NOW - 3600000, stale: true });
  } finally { connection.close(); }
});

test('the newest downloaded row per dog, per account, with a position', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage('account-a', [
      row('a1', 7, NOW - 9000, 5),
      row('a2', 7, NOW - 1000, 9),
      row('a3', 4, NOW - 2000, 5),
      // No position: cannot place a marker, so it must not hide the older row.
      row('a4', 4, NOW - 500, 5, { slave_lat: null, slave_lon: null }),
      row('a5', 3, NOW - MAX_AGE_MS - 1000, 5),
      // 0,0 is what the collar sends without a GPS fix: not a position.
      row('a7', 9, NOW - 100, 5, { slave_lat: 0, slave_lon: 0 }),
      row('a6', 8, NOW - 3000, 5),
    ]);
    await database.savePage('account-b', [row('b1', 7, NOW, 5)]);
    const dogs = await database.latestBySlave('account-a', NOW - MAX_AGE_MS);
    expect(dogs.map(dog => [dog.slave_id, dog.master_id, dog.received_at])).toEqual([
      [4, 5, NOW - 2000], [7, 9, NOW - 1000], [8, 5, NOW - 3000],
    ]);
    expect(await database.latestBySlave('account-b', NOW - MAX_AGE_MS))
      .toEqual([expect.objectContaining({ slave_id: 7, received_at: NOW })]);
    await expect(database.latestBySlave('', 0)).rejects.toThrow('請先登入');
  } finally { connection.close(); }
});

// A stable clock: the hook restarts its timer when `now` changes identity.
const clock = () => NOW;
function Probe({ database, owner, enabled, onState }) {
  onState(useCloudDogs(database, owner, enabled, clock));
  return null;
}

test('the map reads the local copy on a timer and keeps the last rows when a read fails', async () => {
  jest.useFakeTimers();
  try {
    const rows = [{ slave_id: 7, master_id: 5, received_at: NOW, slave_lat: 25, slave_lon: 121 }];
    const database = { latestBySlave: jest.fn(async () => rows) };
    const states = [];
    const view = props => <Probe database={database} onState={state => states.push(state)}
      owner="account-a" enabled {...props} />;
    let renderer;
    await act(async () => { renderer = Renderer.create(view()); });
    expect(database.latestBySlave).toHaveBeenCalledWith('account-a', NOW - MAX_AGE_MS);
    expect(states.at(-1)).toEqual({ rows, packets: [], track: [], error: '' });
    database.latestBySlave.mockRejectedValueOnce(new Error('locked'));
    await act(async () => { await jest.advanceTimersByTimeAsync(POLL_MS); });
    expect(states.at(-1)).toEqual({ rows, packets: [], track: [], error: 'locked' });
    // Demo mode and logout stop the reads and clear the rows.
    await act(async () => { renderer.update(view({ enabled: false })); });
    expect(states.at(-1)).toEqual({ rows: [], packets: [], track: [], error: '' });
    const calls = database.latestBySlave.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(3 * POLL_MS); });
    expect(database.latestBySlave).toHaveBeenCalledTimes(calls);
    await act(async () => { renderer.unmount(); });
  } finally { jest.useRealTimers(); }
});

test('the home map draws one marker per dog and names the source', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const tracking = {
    mode: 'real',
    point: trackingPoint,
    route: emptyLiveRoute(),
    positionSamples: [],
    ready: { real: true },
    errors: {},
    initialSnapshotReady: true,
    foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
    saveTrackingPreferences: jest.fn(),
  };
  const cloudDogs = { rows: [
    { slave_id: 7, master_id: 5, received_at: trackingPoint.receivedAt + 5000,
      slave_lat: 25.2, slave_lon: 121.7 },
  ], error: '' };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} cloudDogs={cloudDogs} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  const markers = renderer.root.findAllByType(Marker)
    .filter(node => typeof node.props.identifier === 'string');
  const dog = markers.filter(node => node.props.identifier === 'real-dog-7');
  expect(dog).toHaveLength(1);
  expect(dog[0].findAll(node => typeof node.props.accessibilityLabel === 'string')[0].props.accessibilityLabel).toContain('經 Master 5・雲端');
  expect(dog[0].props.coordinate).toEqual({ latitude: 25.2, longitude: 121.7 });
  // The single-pair marker is replaced, not drawn on top of the merged one.
  expect(markers.some(node => node.props.identifier === 'real-slave')).toBe(false);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});
