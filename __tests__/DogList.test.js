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

test('tapping a dog follows it and tapping it again releases the camera', async () => {
  const first = screen();
  await expand(first.element);
  await act(async () => rows()[0].props.onPress());
  expect(first.tracking.saveTrackingPreferences)
    .toHaveBeenCalledWith({ focusSlaveId: 4 });

  await act(async () => renderer.unmount());
  const followed = screen({ focusSlaveId: 4 });
  await expand(followed.element);
  expect(rows()[0].props.accessibilityState.selected).toBe(true);
  expect(cardText()).toContain('地圖跟隨中');
  await act(async () => rows()[0].props.onPress());
  expect(followed.tracking.saveTrackingPreferences)
    .toHaveBeenCalledWith({ focusSlaveId: null });
});

test('the map re-centres on the followed dog and leaves the others drawn', async () => {
  await expand(screen({ focusSlaveId: 4 }).element);
  expect(mockCamera.animateCamera).toHaveBeenCalledWith(
    { center: { latitude: 25.04, longitude: 121.57 } }, { duration: 400 },
  );
  const markers = dogMarkers();
  expect(markers.map(node => node.props.identifier))
    .toEqual(['real-dog-4', 'real-dog-6', 'real-dog-7']);
  // Only the followed dog carries the ring.
  const ringed = markers.filter(node => JSON.stringify(node.props.position).includes('"focused":true'));
  expect(ringed.map(node => node.props.identifier)).toEqual(['real-dog-4']);
});

test('following a dog that stopped reporting does not move the camera or crash', async () => {
  // The choice is remembered rather than dropped, so the camera returns to that
  // dog when its next row arrives; until then the map frames everything.
  await expand(screen({ focusSlaveId: 99 }).element);
  expect(mockCamera.animateCamera).not.toHaveBeenCalled();
  expect(rows()).toHaveLength(3);
  expect(rows().every(node => node.props.accessibilityState.selected === false))
    .toBe(true);
});

test('demo mode keeps the single dog row and never lists cloud dogs', async () => {
  await expand(screen({}, 'demo').element);
  const text = cardText();
  expect(text).toContain('狗 · Slave');
  expect(text).not.toContain('Master 5');
});

test('hiding the dog markers keeps the list and keeps following the chosen dog', async () => {
  await expand(screen({ showSlaveMarker: false, focusSlaveId: 4 }).element);
  expect(rows().map(node => node.props.accessibilityLabel))
    .toEqual(['狗 4', '狗 6', '狗 7']);
  expect(dogMarkers()).toHaveLength(0);
  // The card says 跟隨中, so the camera has to actually follow.
  expect(cardText()).toContain('地圖跟隨中');
  expect(mockCamera.animateCamera).toHaveBeenCalledWith(
    { center: { latitude: 25.04, longitude: 121.57 } }, { duration: 400 },
  );
  // One eye in the header covers every dog on the map.
  expect(renderer.root.findAll(
    node => node.props.accessibilityLabel === '顯示所有狗位置', { deep: false }))
    .toHaveLength(1);
});

test('the camera frames a box around the followed dog, never a single point', async () => {
  await expand(screen({ focusSlaveId: 4 }).element);
  // The map fits these on a source change (Demo↔正式, or coming back from the
  // history tab). A single coordinate is a degenerate box and Android fits it
  // at maximum zoom, so the framing has to be a real box around the dog.
  const { cameraPositions } = renderer.root.findAll(
    node => !!node.props.presentation, { deep: false })[0].props.presentation;
  expect(cameraPositions).toHaveLength(2);
  expect(cameraPositions[0].latitude).toBeLessThan(25.04);
  expect(cameraPositions[1].latitude).toBeGreaterThan(25.04);
  expect(cameraPositions[0].longitude).toBeLessThan(121.57);
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

test('cloud dogs have markers but no paths on the live map', async () => {
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
  expect(lines).toHaveLength(0);

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
  const stats = renderer.root.findAll(
    node => node.props.accessibilityLabel?.startsWith('領犬員電量'), { deep: false });
  expect(stats).toHaveLength(1);
  // The battery outline is drawn as an SVG rect; an icon-less Stat rendered an
  // empty box next to the number.
  expect(stats[0].findAllByProps({ testID: 'svg-rect' }).length).toBeGreaterThan(0);
});
