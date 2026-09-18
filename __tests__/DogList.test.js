import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MapView, { mockCamera } from 'react-native-maps';
import { Platform } from 'react-native';
import NativePlatform from '../specs/NativeTrackingPlatform';
import MapScreen from '../src/screens/MapScreen';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const MINUTE = 60000;
// The BLE row is 40 minutes old, so this phone is no longer receiving and the
// dogs of other Masters join the map (the rule confirmed in PR #9).
const blePoint = {
  id: 1, receivedAt: NOW - 40 * MINUTE, masterId: 3, slaveId: 7,
  masterLat: 25.0325, masterLon: 121.5648,
  slaveLat: 25.033, slaveLon: 121.5654,
  speedKmh: 6.2, batteryValid: true, batteryPercentage: 76,
  masterBatteryValid: true, masterBatteryPercentage: 83,
};
const cloudRows = [
  // Older than the 10-minute window, newer than 24 hours: shown, but stale.
  { slave_id: 4, master_id: 5, received_at: NOW - 40 * MINUTE,
    slave_lat: 25.04, slave_lon: 121.57 },
  { slave_id: 6, master_id: 5, received_at: NOW - 2 * MINUTE,
    slave_lat: 25.05, slave_lon: 121.58 },
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
  node => node.props.accessibilityLabel?.startsWith('狗 '), { deep: false });

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
  expect(text).toContain('經 Master 5・雲端');
  expect(text).toContain('早於所選時間範圍，非目前位置');
  // Speed and battery come from the BLE feed, so they name that dog only.
  expect(text).toContain('狗 7 速度');
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
  const markers = renderer.root.findAll(
    node => node.props.title?.startsWith?.('狗 '), { deep: false });
  expect(markers.map(node => node.props.title)).toEqual(['狗 4', '狗 6', '狗 7']);
  // Only the followed dog carries the ring.
  const ringed = markers.filter(node => JSON.stringify(node.props.position).includes('"focused":true'));
  expect(ringed.map(node => node.props.title)).toEqual(['狗 4']);
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
  expect(text).not.toContain('經 Master 5・雲端');
  expect(text).toContain('狗速度');
});

test('hiding the dog markers keeps the list and keeps following the chosen dog', async () => {
  await expand(screen({ showSlaveMarker: false, focusSlaveId: 4 }).element);
  expect(rows().map(node => node.props.accessibilityLabel))
    .toEqual(['狗 4', '狗 6', '狗 7']);
  const markers = renderer.root.findAll(
    node => node.props.title?.startsWith?.('狗 '), { deep: false });
  expect(markers).toHaveLength(0);
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
