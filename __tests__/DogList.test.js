import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MapView, { mockCamera } from 'react-native-maps';
import { Platform } from 'react-native';
import NativePlatform from '../specs/NativeTrackingPlatform';
import MapScreen from '../src/screens/MapScreen';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { mergeDogMarkers } from '../src/map/DogMerge';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const MINUTE = 60000;
// The BLE row is 40 minutes old, so this phone is no longer receiving and the
// dogs of other Masters join the map (the rule confirmed in PR #9).
const blePoint = {
  id: 1, receivedAt: NOW - 40 * MINUTE, masterId: 3, slaveId: 7,
  masterLat: 25.0325, masterLon: 121.5648,
  slaveLat: 25.033, slaveLon: 121.5654,
  speedKmh: 6.2, batteryValid: true, batteryPercentage: 76, distanceMeters: 82.4,
  masterBatteryValid: true, masterBatteryPercentage: 83,
};
const cloudRows = [
  // Older than the 10-minute window, newer than 24 hours: shown, but stale.
  { slave_id: 4, master_id: 5, received_at: NOW - 40 * MINUTE,
    slave_lat: 25.04, slave_lon: 121.57, speed_kmh: 12, battery_percentage: 54 },
  { slave_id: 6, master_id: 5, received_at: NOW - 2 * MINUTE,
    slave_lat: 25.05, slave_lon: 121.58, speed_kmh: 3, battery_percentage: 61 },
];
const emptyRoute = createLiveRouteWindow().snapshot();

function screen(overrides = {}, mode = 'real') {
  const tracking = {
    mode,
    point: blePoint,
    route: emptyRoute,
    positionSamples: [],
    ready: { real: true },
    errors: {},
    initialSnapshotReady: true,
    historyLoaded: true,
    foreground: true,
    preferences: {
      ready: true, busy: false,
      value: { ...DEFAULT_TRACKING_PREFERENCES, mode, ...overrides },
    },
    saveTrackingPreferences: jest.fn(),
  };
  return {
    tracking,
    element: <MapScreen tracking={tracking} phone={{ enabled: true }} bottomInset={80}
      cloudDogs={{ rows: cloudRows, error: '' }} mapProvider={GOOGLE_MAP_PROVIDER} />,
  };
}

// Rendered text only: a failure prints the card, not the whole style tree.
const flatten = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  return flatten(node.children);
};
const cardText = () => flatten(renderer.toJSON());
const rows = () => renderer.root.findAll(
  node => node.props.accessibilityLabel?.startsWith('狗 ') &&
    typeof node.props.onPress === 'function', { deep: false });
// A marker carries no title any more: tapping it opens the device panel, and a
// native bubble on top of that was two boxes for one tap.
const dogMarkers = () => renderer.root.findAll(
  node => node.props.identifier?.startsWith?.('real-dog-'), { deep: false });

let renderer;
const originalOS = Platform.OS;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  Platform.OS = 'android';
  jest.clearAllMocks();
  NativePlatform.isMapConfigured.mockReturnValue(true);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  Platform.OS = originalOS;
  jest.useRealTimers();
});

async function expand(element) {
  await act(async () => { renderer = Renderer.create(element); });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  await act(async () => renderer.root
    .findAllByProps({ testID: 'tracking-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
}

test('the card lists every dog on the map with its source, time and staleness', async () => {
  await expand(screen().element);
  expect(rows().map(node => node.props.accessibilityLabel))
    .toEqual(['狗 4', '狗 6', '狗 7']);
  const text = cardText();
  expect(text).toContain('狗（3）');
  // Where a row came from is an icon plus the Master it came through, so the
  // cloud rows read exactly like the BLE one.
  expect(text).toContain('Master 5');
  expect(text).toContain('BLE 直接收到');
  expect(text).toContain('早於所選時間範圍，非目前位置');
  // Speed, battery and the distance to the Master are written on the row of the
  // dog this phone is receiving, each as its own labelled reading.
  expect(text).toContain('6.2 km/h');
  expect(text).toContain('76%');
  expect(text).toContain('82.4 m');
  // The coordinates are not repeated in the card: the map draws them.
  expect(text).not.toContain('25.033000');
});

test('tapping a dog takes the map to it, and remembers it for next time', async () => {
  const { element, tracking } = screen();
  await expand(element);
  await act(async () => rows()[0].props.onPress());
  // One move per tap, zoomed in. Following — the camera chasing a dog until the
  // row was tapped again — was a mode to remember on a glanceable screen.
  expect(mockCamera.animateCamera).toHaveBeenCalledWith(
    { center: { latitude: 25.04, longitude: 121.57 }, zoom: 17 }, { duration: 400 },
  );
  expect(tracking.saveTrackingPreferences).toHaveBeenCalledWith({ focusSlaveId: 4 });
  // The dog stays as it was: no selected row, no ring on the map.
  expect(rows()[0].props.accessibilityState.selected).toBeUndefined();
  expect(JSON.stringify(dogMarkers().map(node => node.props.position)))
    .not.toContain('focused');
});

test('each row opens that device panel from its own button', async () => {
  await expand(screen().element);
  const details = label => renderer.root.findAll(
    node => node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function', { deep: false })[0];
  expect(details('狗 4詳細資料')).toBeDefined();
  await act(async () => details('狗 4詳細資料').props.onPress());
  expect(cardText()).toContain('狗 4');
  expect(renderer.root.findAllByProps({ testID: 'device-details' }).length)
    .toBeGreaterThan(0);
  // The handler answers the same way, from the same kind of button.
  expect(details('領犬員詳細資料')).toBeDefined();
});

test('the map opens on the dog last tapped, then the connected one, then the cloud',
  async () => {
    const frame = () => renderer.root.findAll(
      node => !!node.props.presentation, { deep: false })[0].props.presentation
      .cameraPositions;
    // The camera also moves there explicitly: the framing is only read when the
    // map mounts, and the cloud dogs arrive a moment after that, so a cold
    // start kept the old view.
    const openedOn = () => mockCamera.animateCamera.mock.calls.at(-1)?.[0]?.center;
    // Remembered: dog 4 (a cloud dog at 25.04).
    await expand(screen({ focusSlaveId: 4 }).element);
    let box = frame();
    expect(box).toHaveLength(2);
    expect(box[0].latitude).toBeLessThan(25.04);
    expect(box[1].latitude).toBeGreaterThan(25.04);
    expect(openedOn()).toEqual({ latitude: 25.04, longitude: 121.57 });
    await act(async () => renderer.unmount());
    // Remembered but no longer reporting: the dog this phone hears over BLE.
    await expand(screen({ focusSlaveId: 99 }).element);
    box = frame();
    expect(box[0].latitude).toBeLessThan(25.033);
    expect(box[1].latitude).toBeGreaterThan(25.033);
    expect(openedOn()).toEqual({ latitude: 25.033, longitude: 121.5654 });
    await act(async () => renderer.unmount());
    // Nothing remembered and no BLE dog: whichever dog the cloud knows about.
    await expand(screen({ focusSlaveId: null, hiddenSlaveIds: [7] }).element);
    box = frame();
    expect(box[0].latitude).toBeLessThan(25.04);
    expect(box[1].latitude).toBeGreaterThan(25.04);
  });

test('the pill says which way in is carrying data, in colour', async () => {
  const live = colour => renderer.root.findAll(
    node => node.props.accessibilityLabel?.includes(colour), { deep: false });
  // The BLE row here is 40 minutes old and the newest cloud row 2 minutes old:
  // one way in is silent, the other is not. The cloud rows come out of SQLite
  // in snake_case, so reading `receivedAt` off them said "no data" forever.
  await expand(screen().element);
  expect(live('Master BLE沒有資料')).toHaveLength(1);
  expect(live('雲端有資料進來')).toHaveLength(1);
});

test('a cold start corrects itself when the remembered dog arrives late', async () => {
  // Only the BLE dog exists in the first render of a cold start; the cloud dogs
  // are merged a moment later. Moving to the BLE dog and calling it done left
  // the map somewhere the handler never asked for.
  const { tracking } = screen({ focusSlaveId: 4 });
  const late = cloudDogs => <MapScreen tracking={tracking} phone={{ enabled: true }}
    bottomInset={80} cloudDogs={cloudDogs} mapProvider={GOOGLE_MAP_PROVIDER} />;
  await act(async () => { renderer = Renderer.create(late({ rows: [], error: '' })); });
  // The map only takes camera commands once the native surface is ready.
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  const centre = () => mockCamera.animateCamera.mock.calls.at(-1)?.[0]?.center;
  expect(centre()).toEqual({ latitude: 25.033, longitude: 121.5654 });
  await act(async () => { renderer.update(late({ rows: cloudRows, error: '' })); });
  await act(async () => {});
  expect(centre()).toEqual({ latitude: 25.04, longitude: 121.57 });
  // Only once: a later refresh of the same dogs must not pull the camera back.
  const calls = mockCamera.animateCamera.mock.calls.length;
  await act(async () => { renderer.update(late({ rows: [...cloudRows], error: '' })); });
  expect(mockCamera.animateCamera.mock.calls).toHaveLength(calls);
});

test('demo mode keeps the single dog row and never lists cloud dogs', async () => {
  await expand(screen({}, 'demo').element);
  const text = cardText();
  expect(text).toContain('狗 · Slave');
  expect(text).not.toContain('Master 5');
});

test('hiding the dog markers keeps the list, and no eye covers all of them', async () => {
  await expand(screen({ showSlaveMarker: false }).element);
  expect(rows().map(node => node.props.accessibilityLabel))
    .toEqual(['狗 4', '狗 6', '狗 7']);
  expect(dogMarkers()).toHaveLength(0);
  // Each dog has its own eye; a second one for "all dogs" was a control nobody
  // needed next to three that already say the same thing.
  expect(renderer.root.findAll(
    node => node.props.accessibilityLabel === '顯示所有狗位置', { deep: false }))
    .toHaveLength(0);
});

test('each dog has its own eye: hiding one leaves the others on the map', async () => {
  const value = screen();
  await expand(value.element);
  const eyes = renderer.root.findAll(
    node => node.props.accessibilityLabel?.includes('狗 ') &&
      node.props.accessibilityLabel?.endsWith('位置'), { deep: false });
  expect(eyes.map(node => node.props.accessibilityLabel)).toEqual([
    '隱藏狗 4 的位置', '隱藏狗 6 的位置', '隱藏狗 7 的位置',
  ]);
  await act(async () => eyes[0].props.onPress());
  expect(value.tracking.saveTrackingPreferences)
    .toHaveBeenCalledWith({ hiddenSlaveIds: [4] });

  await act(async () => renderer.unmount());
  await expand(screen({ hiddenSlaveIds: [4] }).element);
  // The hidden dog leaves the map but stays in the card, with its eye closed.
  expect(dogMarkers().map(node => node.props.identifier))
    .toEqual(['real-dog-6', 'real-dog-7']);
  expect(rows().map(node => node.props.accessibilityLabel))
    .toEqual(['狗 4', '狗 6', '狗 7']);
  expect(renderer.root.findAll(
    node => node.props.accessibilityLabel === '顯示狗 4 的位置',
    { deep: false })).toHaveLength(1);
});

test('showing a dog again also brings back the all-dogs eye', async () => {
  const value = screen({ showSlaveMarker: false, hiddenSlaveIds: [4] });
  await expand(value.element);
  const eye = renderer.root.findAll(
    node => node.props.accessibilityLabel === '顯示狗 4 的位置', { deep: false })[0];
  await act(async () => eye.props.onPress());
  // Otherwise the row's eye would say visible while the map draws nothing.
  expect(value.tracking.saveTrackingPreferences)
    .toHaveBeenCalledWith({ hiddenSlaveIds: [], showSlaveMarker: true });
});

test('every dog is shown from both sources at once, each at its newest row', () => {
  // A handler wants the whole team, not only the dogs of the Master this phone
  // happens to be holding.
  const fresh = { ...blePoint, receivedAt: NOW - 5000 };
  const dogs = mergeDogMarkers({ point: fresh, cloudRows, now: NOW });
  expect(dogs.map(dog => dog.slaveId)).toEqual([4, 6, 7]);
  expect(dogs.find(dog => dog.slaveId === 7).source).toBe('ble');
  expect(dogs.find(dog => dog.slaveId === 4).source).toBe('cloud');
  // The newest row wins per dog: a cloud row newer than the BLE one replaces it.
  const newerInCloud = mergeDogMarkers({
    point: fresh, now: NOW,
    cloudRows: [{ slave_id: 7, master_id: 5, received_at: NOW - 1000,
      slave_lat: 25.06, slave_lon: 121.6 }],
  });
  expect(newerInCloud.map(dog => dog.source)).toEqual(['cloud']);
});

test('a dog that arrived through the cloud gets a path too', async () => {
  const minute = 60000;
  const track = [
    { slave_id: 4, master_id: 5, received_at: NOW - 3 * minute, slave_lat: 25.04, slave_lon: 121.57 },
    { slave_id: 4, master_id: 5, received_at: NOW - 2 * minute, slave_lat: 25.041, slave_lon: 121.571 },
    { slave_id: 4, master_id: 5, received_at: NOW - minute, slave_lat: 25.042, slave_lon: 121.5725 },
  ];
  const tracking = {
    mode: 'real', point: blePoint, route: emptyRoute, positionSamples: [],
    ready: { real: true }, errors: {}, initialSnapshotReady: true, historyLoaded: true,
    foreground: true,
    preferences: { ready: true, busy: false,
      value: { ...DEFAULT_TRACKING_PREFERENCES, mode: 'real', showTrails: true,
        windowMinutes: 10 } },
    saveTrackingPreferences: jest.fn(),
  };
  const element = (
    <MapScreen tracking={tracking} phone={{ enabled: true }} bottomInset={80}
      cloudDogs={{ rows: cloudRows, track, error: '' }} mapProvider={GOOGLE_MAP_PROVIDER} />
  );
  await act(async () => { renderer = Renderer.create(element); });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  // The live feed only holds this phone's pair, so without the downloaded rows
  // the cloud dogs had a marker and no line at all.
  const lines = renderer.root.findAllByProps({ testID: 'map-polyline' })
    .filter(node => Array.isArray(node.props.coordinates));
  expect(lines.length).toBeGreaterThan(0);
  expect(lines[0].props.coordinates).toHaveLength(3);

  // A hidden dog takes its line with it.
  await act(async () => renderer.update(
    <MapScreen tracking={{ ...tracking, preferences: { ready: true, busy: false,
      value: { ...tracking.preferences.value, hiddenSlaveIds: [4] } } }}
      phone={{ enabled: true }} bottomInset={80}
      cloudDogs={{ rows: cloudRows, track, error: '' }} mapProvider={GOOGLE_MAP_PROVIDER} />));
  expect(renderer.root.findAllByProps({ testID: 'map-polyline' })
    .filter(node => Array.isArray(node.props.coordinates))).toHaveLength(0);
});

test('the card says why only one handler is on the map', async () => {
  await expand(screen().element);
  // The cloud rows carry each dog's position and the id of the Master that
  // relayed it — never that Master's own position.
  expect(cardText()).toContain('其他 Master 的位置不在雲端資料裡');
});

test('a cloud row reads like a BLE row: same icons, same readings', async () => {
  await expand(screen().element);
  const rendered = cardText();
  // Both sources carry speed and battery; the cloud rows used to be a thinner
  // row with only a time.
  expect(rendered).toContain('12 km/h');
  expect(rendered).toContain('54%');
  // Distance is the one reading only the connected pair can have.
  expect(rendered).toContain('82.4 m');
});

test('the handler row shows a battery icon too, not a bare number', async () => {
  await expand(screen().element);
  // Every reading carries its icon: the handler's battery was rendering as a
  // value with an empty box where the icon should be.
  const row = renderer.root.findAll(
    node => node.props.accessibilityLabel === '領犬員 · Master 3' &&
      typeof node.props.onPress === 'function', { deep: false })[0];
  const stats = row.findAll(
    node => node.props.accessibilityLabel?.startsWith('電量'), { deep: false });
  expect(stats).toHaveLength(1);
  // The battery outline is drawn as an SVG rect; an icon-less Stat rendered an
  // empty box next to the number.
  expect(stats[0].findAllByProps({ testID: 'svg-rect' }).length).toBeGreaterThan(0);
});
