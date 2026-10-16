import { t as i18nT } from '../src/i18n';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet, Switch } from 'react-native';
import MapView, {
  Circle,
  Marker,
  Polygon,
  Polyline,
  mockCamera,
} from 'react-native-maps';
import NativePlatform from '../specs/NativeTrackingPlatform';
import TrackingMap from '../src/map/TrackingMap';
import { savedCamera, compassTurned } from '../src/map/GoogleTrackingMap';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import MapScreen from '../src/screens/MapScreen';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { cameraCoordinates } from '../src/map/TrackingGeometry';
import { receiverRangeRing } from '../src/map/TrackingMapPresentation';
import { distanceMeters } from '../src/tracking/ReceiverRange';
import { colors, opacity } from '../src/theme/tokens';
import { useInitialLatest } from '../src/app/useInitialLatest';
const master = {
  coordinate: { latitude: 25, longitude: 121 },
  retained: false,
};
const slave = {
  coordinate: { latitude: 25.001, longitude: 121.001 },
  retained: true,
};
// The dog's marker as DogMarkers.dogMarker describes it.
const slaveMarker = { slaveId: 7, coordinate: slave.coordinate, name: '狗 7', tag: '狗 7', indoor: false,
  stale: false, problem: false, selected: false, size: 40, label: '狗 7' };
const defaults = {
  source: 'real',
  presentation: {
    positions: { master, slave },
    slave,
    dogMarkers: [slaveMarker],
    cameraPositions: cameraCoordinates(master, slave),
    slaveSegments: [[master.coordinate, slave.coordinate]],
    rangeRing: receiverRangeRing(master, 'receiving'),
    rangeLines: [],
  },
  topInset: 100,
  bottomInset: 300,
  onMapState: jest.fn(),
  foreground: true,
  provider: GOOGLE_MAP_PROVIDER,
};
let renderer;
const originalOS = Platform.OS;
beforeEach(() => {
  jest.useFakeTimers();
  // The fixtures carry a fixed receivedAt; the home map hides positions older
  // than 24 hours, so run these cases from a clock right after that row.
  jest.setSystemTime(trackingPoint.receivedAt + 60000);
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
async function render(props = {}) {
  await act(async () => {
    renderer = Renderer.create(<TrackingMap {...defaults} {...props} />);
  });
}
async function readyMap() {
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
}

test('repeated foreground recovery retains the same loaded surface and camera', async () => {
  const camera = {
    center: { latitude: 25.04, longitude: 121.24 },
    zoom: 16,
    pitch: 30,
    heading: 60,
  };
  mockCamera.getCamera.mockResolvedValueOnce(camera);
  await render();
  await readyMap();
  const oldMap = renderer.root.findByType(MapView);
  const oldEvents = oldMap.props;
  await act(async () => oldEvents.onRegionChangeComplete({}, { isGesture: true }));
  await act(async () => renderer.update(<TrackingMap {...defaults} foreground={false} />));
  expect(renderer.root.findByType(MapView)).toBe(oldMap);
  await act(async () => renderer.update(<TrackingMap {...defaults} />));
  const restored = renderer.root.findByType(MapView);
  expect(restored).toBe(oldMap);
  expect(restored.props.mapPadding).toBeDefined();
  for (let i = 0; i < 4; i++) {
    await act(async () => renderer.update(<TrackingMap {...defaults} foreground={false} />));
    await act(async () => renderer.update(<TrackingMap {...defaults} />));
    expect(renderer.root.findByType(MapView)).toBe(oldMap);
  }
  expect(defaults.onMapState).toHaveBeenLastCalledWith('ok');
  // Only the first framing, made once under the launch screen.
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
});

test('camera read failure still allows recovery using database coordinates', async () => {
  mockCamera.getCamera.mockRejectedValueOnce(new Error('surface destroyed'));
  await render();
  await readyMap();
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, {}));
  await act(async () => renderer.update(<TrackingMap {...defaults} foreground={false} />));
  await act(async () => renderer.update(<TrackingMap {...defaults} />));
  expect(renderer.root.findByType(MapView).props.initialCamera).toBeUndefined();
  expect(renderer.root.findByType(MapView).props.initialRegion).toMatchObject(master.coordinate);
});
test('Google provider, DB markers, dog trail and a dashed 1000 metre range ring; no receiver marker', async () => {
  await render();
  expect(renderer.root.findByType(MapView).props.provider).toBe('google');
  // The receiver itself is not drawn: only the dog has a marker.
  expect(
    renderer.root.findAllByType(Marker).map(node => node.props.coordinate),
  ).toEqual([slave.coordinate]);
  // The dog's route and the ring's dashed outline.
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(2);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  const fill = renderer.root.findByType(Polygon).props;
  const ring = renderer.root.findAllByType(Polyline).find(node => node.props.testID === 'range-ring').props;
  for (const point of [...fill.coordinates, ...ring.coordinates]) {
    expect(distanceMeters(master.coordinate, point)).toBeCloseTo(1000, -1);
  }
  // The outline is closed.
  expect(ring.coordinates.at(-1)).toEqual(ring.coordinates[0]);
  // Design tokens: rangeRing at 55% for the dashed 1.5dp outline, 6% fill.
  expect(ring.strokeColor).toBe(colors.rangeRing + Math.round(opacity.rangeRingStroke * 255).toString(16).toUpperCase());
  expect(fill.fillColor).toBe(colors.rangeRing + '0F');
  expect(fill.strokeWidth).toBe(0);
  expect(ring.strokeWidth).toBe(1.5);
  expect(ring.lineDashPattern).toHaveLength(2);
  // Round caps make Android draw dots instead of dashes.
  expect(ring.lineCap).toBe('butt');
  expect(ring.tappable).toBe(false);
  expect(fill.tappable).toBe(false);
  // The marker draws no bubble of its own; the text is on its view, where a
  // screen reader finds it.
  expect(renderer.root.findAllByType(Marker)[0].props.title).toBeUndefined();
  expect(renderer.root.findAllByType(Marker)[0].findAll(node =>
    node.props.accessibilityLabel === '狗 7').length).toBeGreaterThan(0);
});

test('out-of-range lines are critLine, 2dp, dashed, drawn above the ring and below routes', async () => {
  const dog = { latitude: 25.012, longitude: 121.001 };
  await render({ presentation: { ...defaults.presentation, slaveSegments: [[master.coordinate, slave.coordinate]],
    rangeLines: [{ slaveId: 4, coordinates: [{ latitude: 25.009, longitude: 121.0008 }, dog] }] } });
  const lines = renderer.root.findAllByType(Polyline);
  const red = lines.find(node => node.props.strokeColor === colors.critLine).props;
  expect(red.coordinates[1]).toEqual(dog);
  expect(red.strokeWidth).toBe(2);
  expect(red.lineDashPattern).toHaveLength(2);
  expect(red.lineCap).toBe('butt');
  const route = lines.find(node => node.props.strokeColor !== colors.critLine && node.props.testID !== 'range-ring').props;
  const ring = lines.find(node => node.props.testID === 'range-ring').props;
  expect(ring.zIndex).toBeLessThan(red.zIndex);
  expect(red.zIndex).toBeLessThan(route.zIndex);
});
test('rotation is on; our compass replaces the native one (top left on Android) and shows once turned', async () => {
  await render({ compassTop: 120 });
  const map = renderer.root.findByType(MapView);
  expect(map.props.showsCompass).toBe(false);
  expect(map.props.rotateEnabled).toBe(true);
  expect(map.props.pitchEnabled).toBe(true);
  expect(map.props.showsMyLocationButton).toBe(false);
  await readyMap();
  const compass = () => renderer.root.findAll(node => node.props.testID === 'map-compass'
    && typeof node.props.onPress === 'function');
  expect(compass()).toHaveLength(0);
  mockCamera.getCamera.mockResolvedValueOnce({ center: master.coordinate, zoom: 15, pitch: 0, heading: 40 });
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
  expect(compass().length).toBeGreaterThan(0);
  const placed = renderer.root.findAll(node => typeof node.type === 'string'
    && [node.props.style].flat().some(style => style?.top === 120));
  expect(placed.length).toBeGreaterThan(0);
  await act(async () => compass()[0].props.onPress());
  expect(mockCamera.animateCamera).toHaveBeenCalledWith({ heading: 0 }, { duration: 300 });
});
// The needle's turn on screen, in degrees, as last drawn.
const needleTurn = () => {
  const needle = renderer.root.findAll(node => typeof node.type === 'string'
    && node.props.testID === 'map-compass-needle')[0];
  const rotate = StyleSheet.flatten(needle.props.style).transform.find(item => item.rotate).rotate;
  return parseFloat(rotate);
};
test('the compass appears and turns with the map during a rotate gesture, not only after it ends', async () => {
  await render({ compassTop: 120 });
  await readyMap();
  const map = () => renderer.root.findByType(MapView);
  const compass = () => renderer.root.findAll(node => node.props.testID === 'map-compass'
    && typeof node.props.onPress === 'function');
  // Every camera frame of the gesture brings the bearing (patched
  // react-native-maps, DOGTRACKER_CAMERA_HEADING); no getCamera round trip.
  await act(async () => map().props.onRegionChange({}, { isGesture: true, heading: 20 }));
  expect(compass().length).toBeGreaterThan(0);
  expect(needleTurn()).toBeCloseTo(-20);
  await act(async () => map().props.onRegionChange({}, { isGesture: true, heading: 75 }));
  expect(needleTurn()).toBeCloseTo(-75);
  // Back to north mid-gesture: the compass goes away again.
  await act(async () => map().props.onRegionChange({}, { isGesture: true, heading: 0.2 }));
  expect(compass()).toHaveLength(0);
});
test('a camera read from before the latest frame does not turn the needle back', async () => {
  await render({ compassTop: 120 });
  await readyMap();
  const map = () => renderer.root.findByType(MapView);
  let answer;
  mockCamera.getCamera.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
  await act(async () => map().props.onRegionChangeComplete({}, { isGesture: true, heading: 30 }));
  expect(needleTurn()).toBeCloseTo(-30);
  // The next gesture starts before the idle read answers.
  await act(async () => map().props.onRegionChange({}, { isGesture: true, heading: 90 }));
  await act(async () => answer({ center: master.coordinate, zoom: 15, pitch: 0, heading: 30 }));
  expect(needleTurn()).toBeCloseTo(-90);
});
test('compass threshold: shows past 1° either side of north, hides within 0.5°', () => {
  expect(compassTurned(0)).toBe(false);
  expect(compassTurned(0.8)).toBe(false);
  expect(compassTurned(1.5)).toBe(true);
  expect(compassTurned(358.5)).toBe(true);
  expect(compassTurned(359.5)).toBe(false);
  expect(compassTurned(-2)).toBe(true);
  // Once shown, it stays until within 0.5°.
  expect(compassTurned(0.8, true)).toBe(true);
  expect(compassTurned(359.7, true)).toBe(false);
});
test('provider draws the prepared visible segments; empty presentation removes every overlay', async () => {
  await render({
    presentation: {
      ...defaults.presentation,
      slaveSegments: [[master.coordinate, slave.coordinate], [slave.coordinate, master.coordinate]],
    },
  });
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(3);
  await act(async () =>
    renderer.update(
      <TrackingMap
        {...defaults}
        source="history:range"
        presentation={{
          positions: {},
          slave: null,
          slaveSegments: [],
          rangeRing: null,
          rangeLines: [],
          cameraPositions: [],
        }}
      />,
    ),
  );
  expect(renderer.root.findAllByType(Marker)).toHaveLength(0);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  expect(renderer.root.findAllByType(Polygon)).toHaveLength(0);
});

test('switching data source reuses the native map and reframes the new source', async () => {
  await render();
  await readyMap();
  const nativeMap = renderer.root.findByType(MapView);
  const fits = mockCamera.fitToCoordinates.mock.calls.length;
  // The first framing.
  expect(fits).toBe(1);
  await act(async () =>
    renderer.update(
      <TrackingMap
        {...defaults}
        source="history:range"
        provider={GOOGLE_MAP_PROVIDER}
      />,
    ),
  );
  expect(renderer.root.findByType(MapView)).toBe(nativeMap);
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(fits + 1);
});
test('a switched source waits for framingReady before its one fit', async () => {
  await render();
  await readyMap();
  mockCamera.fitToCoordinates.mockClear();
  await act(async () => renderer.update(<TrackingMap {...defaults} source="real:fixture:x" framingReady={false} />));
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
  await act(async () => renderer.update(<TrackingMap {...defaults} source="real:fixture:x" framingReady />));
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<TrackingMap {...defaults} source="real:fixture:x" framingReady
    bottomInset={120} />));
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
});
test('missing key never mounts native map: grey, and the map says it cannot open', async () => {
  NativePlatform.isMapConfigured.mockReturnValue(false);
  await render();
  expect(renderer.root.findAllByType(MapView)).toHaveLength(0);
  expect(renderer.root.findAll(node => node.props.testID === 'map-unavailable')).not.toHaveLength(0);
  expect(defaults.onMapState).toHaveBeenLastCalledWith('unavailable');
});
test('no tiles within the load timeout is 地圖載入失敗; 重試 opens a new map that reports retrying', async () => {
  await render();
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  expect(defaults.onMapState).toHaveBeenLastCalledWith('loading');
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(defaults.onMapState).toHaveBeenLastCalledWith('load-failed');
  const first = renderer.root.findByType(MapView);
  await act(async () => renderer.update(<TrackingMap {...defaults} retryKey={1} />));
  expect(renderer.root.findByType(MapView)).not.toBe(first);
  expect(defaults.onMapState).toHaveBeenLastCalledWith('retrying');
  await readyMap();
  expect(defaults.onMapState).toHaveBeenLastCalledWith('ok');
});
test('tiles arriving after the load timeout (the network came back) clear 地圖載入失敗 without 重試', async () => {
  await render();
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(defaults.onMapState).toHaveBeenLastCalledWith('load-failed');
  const map = renderer.root.findByType(MapView);
  await act(async () => map.props.onMapLoaded());
  expect(renderer.root.findByType(MapView)).toBe(map);
  expect(defaults.onMapState).toHaveBeenLastCalledWith('ok');
});
test('no source yet and no saved camera opens the map instead of throwing (地圖打不開)', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await render({ source: undefined });
    expect(renderer.root.findAllByType(MapView)).toHaveLength(1);
    expect(renderer.root.findByType(MapView).props.initialCamera).toBeUndefined();
    expect(renderer.root.findAll(node => node.props.testID === 'map-unavailable')).toHaveLength(0);
    // A retry (a new native instance) with still nothing saved.
    await act(async () => renderer.update(<TrackingMap {...defaults} source={undefined} retryKey={1} />));
    expect(renderer.root.findAllByType(MapView)).toHaveLength(1);
    expect(defaults.onMapState).not.toHaveBeenCalledWith('unavailable');
  } finally { error.mockRestore(); }
});
test('savedCamera: only a camera saved for the same source', () => {
  const camera = { zoom: 14 };
  expect(savedCamera(null, undefined)).toBeUndefined();
  expect(savedCamera(undefined, 'real')).toBeUndefined();
  expect(savedCamera({ source: 'real', camera }, 'real')).toBe(camera);
  expect(savedCamera({ source: 'real', camera }, 'history')).toBeUndefined();
  expect(savedCamera({ source: undefined }, undefined)).toBeUndefined();
});
test('a map that throws while opening is caught: grey and unavailable, and 重試 tries again', async () => {
  const Broken = () => { throw new Error('native map missing'); };
  const provider = { ...GOOGLE_MAP_PROVIDER, Renderer: Broken };
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  await render({ provider });
  expect(renderer.root.findAll(node => node.props.testID === 'map-unavailable')).not.toHaveLength(0);
  expect(defaults.onMapState).toHaveBeenLastCalledWith('unavailable');
  await act(async () => renderer.update(<TrackingMap {...defaults} provider={GOOGLE_MAP_PROVIDER} retryKey={1} />));
  expect(renderer.root.findAllByType(MapView)).toHaveLength(1);
  warn.mockRestore();
  error.mockRestore();
});
const pressLabel = async label => act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === label
  && typeof node.props.onPress === 'function')[0].props.onPress());

test('我的位置 moves to the phone in 300 ms without remounting the map', async () => {
  await render({ livePhone: { running: true, ageSeconds: 1, position: { latitude: 24.9, longitude: 121.2, accuracy: 5, timestamp: Date.now() } } });
  await readyMap();
  const map = renderer.root.findByType(MapView);
  expect(renderer.root.findAll(node => node.props.testID === 'map-tip')).toHaveLength(0);
  await pressLabel('我的位置');
  expect(mockCamera.animateCamera).toHaveBeenCalledWith({ center: { latitude: 24.9, longitude: 121.2 } }, { duration: 300 });
  expect(renderer.root.findByType(MapView)).toBe(map);
});

test.each([null, { running: true, ageSeconds: 601, position: { latitude: 24.9, longitude: 121.2, accuracy: 5, timestamp: 1 } }])('without a usable phone fix %o 我的位置 stays normal; only a tap reports missing location', async livePhone => {
  // Visual availability does not make an expired fix eligible for framing.
  await render({ livePhone });
  await readyMap();
  mockCamera.animateCamera.mockClear();
  const glyphColor = () => renderer.root.find(node => node.props.testID === 'map-my-location')
    .findAll(node => node.props.name === 'locate')[0].props.color;
  expect(glyphColor()).toBe(colors.phone);
  expect(renderer.root.find(node => node.props.testID === 'map-my-location').props.accessibilityHint).not.toBe('手機沒有定位');
  await pressLabel('我的位置');
  expect(mockCamera.animateCamera).not.toHaveBeenCalled();
  const tips = () => renderer.root.findAll(node => node.props.testID === 'map-tip' && typeof node.type !== 'string');
  expect(tips().length).toBeGreaterThan(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('"手機沒有定位"]');
  // Gone after 5 seconds.
  await act(async () => jest.advanceTimersByTime(5000));
  expect(renderer.root.findAll(node => node.props.testID === 'map-tip')).toHaveLength(0);
});

test('a confirmed phone permission or service problem remains distinct and the button is still pressable', async () => {
  const tracking = { mode: 'real', point: trackingPoint, route: emptyLiveRoute(), ready: { real: true },
    errors: { real: null }, initialSnapshotReady: true, historyLoaded: true, foreground: true,
    preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES } };
  for (const phone of [{ permission: 'denied', services: true }, { permission: 'precise', services: false }]) {
    await act(async () => { renderer = Renderer.create(<MapScreen tracking={tracking} phone={phone}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />); });
    await readyMap();
    const button = renderer.root.find(node => node.props.testID === 'map-my-location');
    expect(button.findAll(node => node.props.name === 'locate')[0].props.color).toBe(colors.iconMuted);
    mockCamera.animateCamera.mockClear();
    await pressLabel('我的位置');
    expect(mockCamera.animateCamera).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    renderer = null;
  }
});

test('a confirmed phone problem reaches the live dot independently of old-fix age', async () => {
  const livePhone = { running: true, ageSeconds: 601, sessionId: 'unit',
    position: { latitude: 25, longitude: 121, accuracy: 5, timestamp: 1 } };
  await render({ livePhone, phoneProblem: true });
  const dot = () => renderer.root.findByProps({ testID: 'phone-location-dot' });
  const muted = StyleSheet.flatten(dot().props.style).backgroundColor;
  await act(async () => renderer.update(<TrackingMap {...defaults} livePhone={livePhone} phoneProblem={false} />));
  expect(StyleSheet.flatten(dot().props.style).backgroundColor).not.toBe(muted);
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(false);
});

test('框住全部 fits every dog, however far, and the phone, with room for the name tags', async () => {
  const far = { ...slaveMarker, slaveId: 8, tag: '阿福', name: '阿福', size: 48, problem: true, stale: true,
    coordinate: { latitude: 24.93, longitude: 121.24 } };
  await render({ presentation: { ...defaults.presentation, dogMarkers: [slaveMarker, far] },
    livePhone: { running: true, ageSeconds: 3, position: { latitude: 25.002, longitude: 121.0, accuracy: 5, timestamp: Date.now() } } });
  await readyMap();
  mockCamera.fitToCoordinates.mockClear();
  await pressLabel('框住全部');
  const [points, options] = mockCamera.fitToCoordinates.mock.calls[0];
  expect(points).toEqual([slave.coordinate, far.coordinate, { latitude: 25.002, longitude: 121.0 }]);
  expect(options.animated).toBe(true);
  // 24dp beyond the 48dp face's "!" and the name tag under it.
  expect(options.edgePadding.top).toBeGreaterThanOrEqual(24 + 24);
  expect(options.edgePadding.bottom).toBeGreaterThan(options.edgePadding.top);
  // Pressing a button is the user's move: later rows never refit.
  await act(async () => renderer.update(<TrackingMap {...defaults} source="real" />));
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
});

test('the buttons sit 16dp from the right, 12dp above the card, and only on the live map', async () => {
  await render();
  await readyMap();
  const buttons = renderer.root.find(node => node.props.testID === 'map-frame-all').parent;
  const column = renderer.root.findAll(node => typeof node.type === 'string' && node.props.style
    && StyleSheet.flatten(node.props.style).right === 16 && StyleSheet.flatten(node.props.style).bottom === 300);
  expect(buttons).toBeTruthy();
  expect(column.length).toBeGreaterThan(0);
  await act(async () => renderer.update(<TrackingMap {...defaults}
    presentation={{ ...defaults.presentation, historyRoute: { color: '#1A73E8', lines: [], places: [], times: [],
      cursor: null, camera: [], points: [] } }} />));
  expect(renderer.root.findAll(node => node.props.testID === 'map-frame-all')).toHaveLength(0);
});

test('the launch screen hands over only after the first framing is drawn, or after a wait with nothing to frame', async () => {
  const splash = require('../src/app/hideSplash');
  const phase = () => splash.getSplashState().phase;
  // The start decided on the map (App): its framing releases the launch screen.
  splash.resetSplashGate();
  splash.launchInto('map');
  await render({ framingReady: false });
  await readyMap();
  // Loaded but not framed: the launch screen stays, however long the
  // framing takes (with something to frame the wait is not cut short).
  await act(async () => jest.advanceTimersByTime(5000));
  expect(phase()).toBe('waiting');
  await act(async () => renderer.update(<TrackingMap {...defaults} framingReady />));
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  expect(phase()).toBe('waiting');
  // The fitted camera is reported drawn: the dogs on screen are handed over.
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, {}));
  await act(async () => {});
  expect(phase()).toBe('handover');
  await act(async () => renderer.unmount());
  renderer = null;
  splash.resetSplashGate();
  splash.launchInto('map');
  // Nothing to frame: released after FIRST_FRAME_WAIT_MS, as a plain fade.
  await render({ presentation: { ...defaults.presentation, cameraPositions: [], dogMarkers: [] } });
  await readyMap();
  expect(phase()).toBe('waiting');
  await act(async () => jest.advanceTimersByTime(3000));
  expect(splash.getSplashState()).toMatchObject({ phase: 'handover', mode: 'fade' });
  // Before the start is decided (D1 may come first), the framing alone
  // never releases it.
  await act(async () => renderer.unmount());
  renderer = null;
  splash.resetSplashGate();
  await render({ presentation: { ...defaults.presentation, cameraPositions: [], dogMarkers: [] } });
  await readyMap();
  await act(async () => jest.advanceTimersByTime(3000));
  expect(phase()).toBe('waiting');
  splash.launchInto('map');
  expect(phase()).toBe('handover');
  splash.resetSplashGate();
});

test('the handover goes to the dog nearest the middle; the others in order of distance from it', () => {
  const { splashTargets } = require('../src/map/GoogleTrackingMap');
  const marker = slaveId => ({ slaveId, size: 40, tag: `狗 ${slaveId}`, coordinate: {} });
  const targets = splashTargets(
    { dogMarkers: [marker(1), marker(2), marker(3), marker(4)], avatars: { 2: { kind: 'art' } },
      width: 400, height: 800, top: 40, bottom: 40 },
    { 1: { x: 50, y: 100 }, 2: { x: 210, y: 390 }, 3: { x: 300, y: 500 }, 4: { x: 500, y: 400 } },
  );
  // Dog 4 is off screen; dog 2 is nearest the middle (200, 400).
  expect(targets.map(t => t.slaveId)).toEqual([2, 3, 1]);
  expect(targets[0]).toMatchObject({ x: 210, y: 390, avatar: { kind: 'art' } });
  expect(splashTargets({ dogMarkers: [], avatars: {}, width: 400, height: 800 }, {})).toEqual([]);
});

test('new DB rows never refit the camera after panning', async () => {
  await render();
  await readyMap();
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  const count = mockCamera.fitToCoordinates.mock.calls.length;
  await act(async () => renderer.root.findByType(MapView).props.onPanDrag());
  await act(async () =>
    renderer.update(
      <TrackingMap
        {...defaults}
        presentation={{
          ...defaults.presentation,
          slave: {
            ...slave,
            coordinate: { latitude: 26, longitude: 121 },
          },
        }}
        bottomInset={100}
      />,
    ),
  );
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(count);
  expect(mockCamera.animateToRegion).not.toHaveBeenCalled();
});
test('the live map ignores the history tab parameters and old per-dog eyes', async () => {
  const tracking = {
    mode: 'real', point: trackingPoint, route: emptyLiveRoute(),
    ready: { real: true }, errors: {}, initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES },
    saveTrackingPreferences: jest.fn(),
  };
  // History settings used to reach into the live map and hide the dog; since
  // the history tab exists they describe that tab only.
  const screen = client => <MapScreen tracking={tracking} phone={{ enabled: true }} bottomInset={80}
    mapProvider={GOOGLE_MAP_PROVIDER} history={{ preferences: { client, phone: client } }} />;
  await act(async () => { renderer = Renderer.create(screen(true)); });
  await readyMap();
  const dogShown = () => renderer.root.findAllByType(Marker)
    .some(node => ['real-dog-7', 'real-slave'].includes(node.props.identifier));
  expect(dogShown()).toBe(true);
  await act(async () => renderer.update(screen(false)));
  expect(dogShown()).toBe(true);
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(true);
  // v3 has no eyes: what an older version stored (all dogs hidden, one dog
  // hidden, one followed) no longer hides or moves anything.
  await act(async () => renderer.update(
    <MapScreen tracking={{ ...tracking, preferences: { ready: true,
      value: { ...DEFAULT_TRACKING_PREFERENCES, showSlaveMarker: false, hiddenSlaveIds: [7], focusSlaveId: 7 } } }}
      phone={{ enabled: true }} bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />));
  expect(dogShown()).toBe(true);
  expect(renderer.root.findAll(node => !!node.props.presentation, { deep: false })[0].props.presentation.follow)
    .toBeUndefined();
});

test('the live map has no sheet: a tapped dog opens its card, and the receiver has no panel', async () => {
  const tracking = {
    mode: 'real',
    point: trackingPoint,
    route: emptyLiveRoute(),
    ready: { real: true },
    errors: { real: 'locked' },
    historyLoaded: true,
    foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
    saveTrackingPreferences: jest.fn(),
  };
  const onCardChange = jest.fn();
  await act(async () => {
    renderer = Renderer.create(
      <MapScreen tracking={tracking} phone={{ enabled: true, permission: 'precise' }} bottomInset={80}
        mapProvider={GOOGLE_MAP_PROVIDER} onCardChange={onCardChange} />,
    );
  });
  expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'fullscreen-map-screen' }).props.style))
    .toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
  // No dog list, no follow button, no eyes, no receiver row: v3 removed them.
  expect(renderer.root.findAllByProps({ testID: 'tracking-sheet' })).toHaveLength(0);
  expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('跟隨');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('領犬員');
  expect(JSON.stringify(renderer.toJSON())).toContain('讀取失敗：locked');
  await readyMap();
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(true);
  expect(renderer.root.findAllByType(Marker).some(node => node.props.identifier === 'real-master')).toBe(false);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
  // A tap on the dog opens its card (the bottom tabs hide under it).
  const map = () => renderer.root.findAll(node => typeof node.props.onDogPress === 'function', { deep: false })[0];
  await act(async () => map().props.onDogPress(7));
  expect(renderer.root.findAllByProps({ testID: 'dog-card' }).length).toBeGreaterThan(0);
  expect(onCardChange).toHaveBeenLastCalledWith(true);
  expect(JSON.stringify(renderer.toJSON())).toContain(i18nT('c071'));
  // Its marker is the selected one; a tap on the map itself is now listened to.
  expect(map().props.presentation.dogMarkers[0].selected).toBe(true);
  expect(typeof map().props.onMapPress).toBe('function');
});
test('tile completion and changed padding never refit an already framed map', async () => {
  await render();
  await readyMap();
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  await act(async () =>
    renderer.update(
      <TrackingMap {...defaults} topInset={40} bottomInset={100} />,
    ),
  );
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  expect(defaults.onMapState.mock.calls.every(([value]) => value === 'loading' || value === 'ok')).toBe(
    true,
  );
});

test('waits for initial DB positions; a later readiness change does not remount native map with stale readiness', async () => {
  await render({ dataReady: false });
  expect(renderer.root.findAllByType(MapView)).toHaveLength(0);
  await act(async () =>
    renderer.update(<TrackingMap {...defaults} dataReady />),
  );
  expect(renderer.root.findByType(MapView).props.initialRegion).toMatchObject(
    master.coordinate,
  );
  await readyMap();
  await act(async () =>
    renderer.update(
      <TrackingMap
        {...defaults}
        dataReady={false}
        presentation={{
          ...defaults.presentation,
          rangeRing: null,
          slave: null,
        }}
      />,
    ),
  );
  expect(renderer.root.findAllByType(MapView)).toHaveLength(1);
});

test('map screen mounts after its initial snapshot while history pages are still loading', async () => {
  const tracking = {
    mode: 'real',
    point: trackingPoint,
    route: emptyLiveRoute(),
    positionSamples: [],
    ready: { real: true },
    errors: { real: null },
    initialSnapshotReady: true,
    historyLoaded: false,
    foreground: true,
    preferences: {
      ready: true,
      busy: false,
      error: null,
      value: DEFAULT_TRACKING_PREFERENCES,
    },
  };
  await act(async () => {
    renderer = Renderer.create(
      <MapScreen
        tracking={tracking}
        alerts={{ status: 'fresh' }}
        phone={{ enabled: false }}
        bottomInset={80}
        mapProvider={GOOGLE_MAP_PROVIDER}
      />,
    );
  });
  expect(renderer.root.findAllByType(MapView)).toHaveLength(1);
});

test('phone blue dot requires permission, ready map and foreground; never adds phone to DB markers or framing', async () => {
  await render({ phoneEnabled: true });
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(false);
  await readyMap();
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(true);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
  // The first framing frames the presentation's points only; the phone's
  // blue dot adds nothing to it.
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  expect(mockCamera.fitToCoordinates.mock.calls[0][0]).toEqual(defaults.presentation.cameraPositions);
  await act(async () =>
    renderer.update(
      <TrackingMap {...defaults} phoneEnabled foreground={false} />,
    ),
  );
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(false);
  await act(async () =>
    renderer.update(<TrackingMap {...defaults} phoneEnabled={false} />),
  );
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(false);
});

test('name tags that would overlap on screen merge into 「N 隻」; a source switch never reuses old places', async () => {
  const at = (slaveId, latitude, extra = {}) => ({ ...slaveMarker, slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`,
    label: `狗 ${slaveId}`, coordinate: { latitude, longitude: 121.001 }, ...extra });
  // One degree of latitude is 100000 dp on this pretend screen.
  mockCamera.pointForCoordinate = jest.fn(async ({ latitude, longitude }) =>
    ({ x: (longitude - 121) * 100000, y: (25.01 - latitude) * 100000 }));
  try {
    const markers = [at(4, 25.0010), at(6, 25.00101, { indoor: true, tag: '狗 6・室內' }), at(8, 25.005)];
    await render({ presentation: { ...defaults.presentation, dogMarkers: markers } });
    await readyMap();
    const tagTexts = () => renderer.root.findAll(node => ['dog-name-tag', 'dog-group-tag'].includes(node.props.testID)
      && typeof node.type === 'string').map(node => node.findByType(require('react-native').Text).props.children);
    expect(tagTexts().sort()).toEqual(['2 隻', '狗 8']);
    // Another source: nothing drawn from the old places until the new ones are read.
    mockCamera.pointForCoordinate.mockImplementation(() => new Promise(() => {}));
    await act(async () => renderer.update(<TrackingMap {...defaults} source="other"
      presentation={{ ...defaults.presentation, dogMarkers: markers }} />));
    expect(tagTexts()).toEqual([]);
  } finally {
    delete mockCamera.pointForCoordinate;
  }
});

test('bottom tags keep the real dog coordinates through pan and zoom, without independent labels or leaders', async () => {
  let shift = 0;
  const markers = [4, 6, 8].map((slaveId, index) => ({ ...slaveMarker, slaveId,
    name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, label: `狗 ${slaveId}`,
    coordinate: { latitude: 25.005, longitude: 121.002 + index * 0.00001 } }));
  const original = JSON.stringify(markers);
  const onDogPress = jest.fn();
  mockCamera.pointForCoordinate = jest.fn(async p => ({
    x: (p.longitude - 121) * 100000 + shift, y: (25.01 - p.latitude) * 100000,
  }));
  // A real native map has both directions. Leaving the reverse projection
  // absent would silently fall back to old markers and miss the regression.
  mockCamera.coordinateForPoint = jest.fn(async p => ({
    latitude: 25.01 - p.y / 100000, longitude: 121 + (p.x - shift) / 100000,
  }));
  mockCamera.getCamera.mockResolvedValue({ center: markers[0].coordinate, heading: 0, zoom: 19 });
  try {
    await render({ onDogPress, presentation: { ...defaults.presentation, dogMarkers: markers,
      slaveSegments: [], rangeRing: null } });
    await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    await readyMap();
    const verify = () => {
      const faces = renderer.root.findAllByType(Marker);
      expect(faces.map(node => node.props.coordinate)).toEqual(markers.map(marker => marker.coordinate));
      expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
      expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
      return faces;
    };
    verify();
    await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
    for (let i = 0; i < 5; i++) await act(async () => jest.advanceTimersByTime(400));
    verify().forEach((face, index) => {
      const tag = face.findAll(node => node.props.testID === 'dog-name-tag' && typeof node.type === 'string');
      expect(tag).toHaveLength(1);
      expect(tag[0].findByType(require('react-native').Text).props.children).toBe(markers[index].tag);
    });
    shift = 30;
    mockCamera.getCamera.mockResolvedValue({ center: markers[0].coordinate, heading: 35, zoom: 14 });
    await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
    for (let i = 0; i < 5; i++) await act(async () => jest.advanceTimersByTime(400));
    const faces = verify();
    const groups = renderer.root.findAll(node => node.props.testID === 'dog-group-tag' && typeof node.type === 'string');
    expect(groups).toHaveLength(1);
    expect(groups[0].findByType(require('react-native').Text).props.children).toBe('3 隻');
    await act(async () => faces.find(face => face.props.identifier === 'real-dog-6').props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(6);
    const a11y = renderer.root.findAll(node => /^marker-a11y-\d+$/.test(node.props.testID || '')
      && typeof node.type === 'string');
    expect(a11y.map(node => node.props.testID).sort()).toEqual(['marker-a11y-4', 'marker-a11y-6', 'marker-a11y-8']);
    expect(JSON.stringify(markers)).toBe(original);
  } finally {
    delete mockCamera.pointForCoordinate;
    delete mockCamera.coordinateForPoint;
    mockCamera.getCamera.mockResolvedValue(null);
  }
});

describe('off-screen hints and the overlap menu', () => {
  const at = (slaveId, latitude, longitude, extra = {}) => ({ ...slaveMarker, slaveId, name: `狗 ${slaveId}`,
    tag: `狗 ${slaveId}`, label: `狗 ${slaveId}`, coordinate: { latitude, longitude }, ...extra });
  // 100000 dp per degree on this pretend 400×800 screen, (25.01, 121) top left.
  beforeEach(() => {
    mockCamera.pointForCoordinate = jest.fn(async ({ latitude, longitude }) =>
      ({ x: (longitude - 121) * 100000, y: (25.01 - latitude) * 100000 }));
  });
  afterEach(() => { delete mockCamera.pointForCoordinate; });
  async function layout() {
    await act(async () => renderer.root.find(node => node.props.testID === 'tracking-map-container')
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
  }

  test('dogs with a problem off the left get one hint (healthy ones none); tapping it frames them', async () => {
    const markers = [at(4, 25.005, 121.002), at(6, 25.005, 120.99, { problem: true, size: 48 }),
      at(8, 25.004, 120.98, { problem: true, size: 48 }), at(5, 25.006, 120.985),
      at(9, 25.005, 121.02)];
    await render({ presentation: { ...defaults.presentation, dogMarkers: markers } });
    await layout();
    await readyMap();
    const hints = renderer.root.findAll(node => node.props.testID === 'edge-hint-left' && node.props.onPress);
    expect(hints).toHaveLength(1);
    expect(hints[0].props.accessibilityLabel).toBe('左邊畫面外有 2 隻狗有問題：狗 6、狗 8，點兩下移過去');
    expect(renderer.root.findAll(node => node.props.testID === 'edge-hint-face-problem'
      && typeof node.type === 'string')).toHaveLength(2);
    expect(renderer.root.findAll(node => node.props.testID === 'edge-hint-face'
      && typeof node.type === 'string')).toHaveLength(0);
    // Dog 9 (healthy, off the right) has no hint.
    expect(renderer.root.findAll(node => /^edge-hint-(?!left|face|arrow)/.test(node.props.testID || '')
      && node.props.onPress)).toHaveLength(0);
    mockCamera.fitToCoordinates.mockClear();
    await act(async () => hints[0].props.onPress());
    // Framed in 300 ms (motion.camera): a region holding both dogs.
    const [region, duration] = mockCamera.animateToRegion.mock.calls[0];
    expect(duration).toBe(300);
    for (const dog of [markers[1], markers[2]]) {
      expect(Math.abs(dog.coordinate.latitude - region.latitude)).toBeLessThan(region.latitudeDelta / 2);
      expect(Math.abs(dog.coordinate.longitude - region.longitude)).toBeLessThan(region.longitudeDelta / 2);
    }
    expect(Math.abs(markers[0].coordinate.longitude - region.longitude)).toBeGreaterThan(region.longitudeDelta / 2);
    // While the camera moves the hints wait; the camera stopping reads the
    // dogs' places again and brings them back.
    const left = () => renderer.root.findAll(node => node.props.testID === 'edge-hint-left' && node.props.onPress);
    expect(left()).toHaveLength(0);
    await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, {}));
    // Once two reads agree (066: a move's end is not always reported).
    for (let i = 0; i < 4; i += 1) await act(async () => jest.advanceTimersByTime(400));
    expect(left()).toHaveLength(1);
  });

  test('066: tapping the dog carrying 「3 隻」 opens that dog — there is no list of dogs', async () => {
    const onDogPress = jest.fn();
    const markers = [at(4, 25.005, 121.002), at(6, 25.00501, 121.0021, { problem: true, size: 48 }),
      at(8, 25.00499, 121.0019)];
    await render({ onDogPress, presentation: { ...defaults.presentation, dogMarkers: markers } });
    await layout();
    await readyMap();
    const lead = renderer.root.findAll(node => node.type === Marker && node.props.identifier?.startsWith('real-dog-')
      && /^3 隻/.test(node.props.children.props.accessibilityLabel || ''));
    expect(lead).toHaveLength(1);
    await act(async () => lead[0].props.onPress());
    expect(onDogPress).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll(node => /^overlap-row-\d+$/.test(node.props.testID || ''))).toHaveLength(0);
    // TalkBack reaches every dog of the group on its own (no list to go through).
    const items = renderer.root.findAll(node => /^marker-a11y-\d+$/.test(node.props.testID || '') && typeof node.type === 'string');
    expect(items.map(node => node.props.testID).sort()).toEqual(['marker-a11y-4', 'marker-a11y-6', 'marker-a11y-8']);
  });

  test('066: zoomed in, every dog keeps its own name tag (no 「N 隻」)', async () => {
    const markers = [at(4, 25.005, 121.002, { indoor: true }), at(6, 25.00501, 121.0021, { indoor: true }),
      at(8, 25.00499, 121.0019, { indoor: true })];
    mockCamera.getCamera.mockResolvedValue({ center: { latitude: 25, longitude: 121 }, heading: 0, zoom: 19 });
    try {
      await render({ presentation: { ...defaults.presentation, dogMarkers: markers } });
      await layout();
      await readyMap();
      await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, {}));
      await act(async () => jest.advanceTimersByTime(5000));
      const groups = renderer.root.findAll(node => node.props.testID === 'dog-group-tag' && typeof node.type === 'string');
      expect(groups).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.testID === 'dog-name-tag'
        && typeof node.type === 'string')).toHaveLength(3);
    } finally {
      mockCamera.getCamera.mockResolvedValue(null);
    }
  });

  test('066: a camera move whose end is never reported still refreshes the hints', async () => {
    const markers = [at(4, 25.005, 121.002), at(6, 25.005, 120.99, { problem: true, size: 48 })];
    await render({ presentation: { ...defaults.presentation, dogMarkers: markers } });
    await layout();
    await readyMap();
    const left = () => renderer.root.findAll(node => node.props.testID === 'edge-hint-left' && node.props.onPress);
    expect(left()).toHaveLength(1);
    // The camera moves so that dog 6 is on screen, slowly (a busy phone): the
    // first read after the move still finds the old places; its end is never
    // reported (no onRegionChangeComplete).
    const before = mockCamera.pointForCoordinate.getMockImplementation();
    let calls = 0;
    mockCamera.pointForCoordinate.mockImplementation(async coordinate => {
      calls += 1;
      if (calls <= 4) return before(coordinate);
      return { x: (coordinate.longitude - 120.985) * 20000, y: (25.01 - coordinate.latitude) * 100000 };
    });
    await act(async () => left()[0].props.onPress());
    for (let i = 0; i < 12; i += 1) await act(async () => jest.advanceTimersByTime(400));
    expect(left()).toHaveLength(0);
  });
});

test('a dog whose card opens is moved into view once, only when the card or an edge hides it', async () => {
  // The map is 400 × 800; the card covers the bottom 300dp; the map's own
  // padding stays at 80 (opening a card does not shift the map).
  let point = { x: 200, y: 700 };
  mockCamera.pointForCoordinate = jest.fn(async () => point);
  mockCamera.coordinateForPoint = jest.fn(async ({ x, y }) => ({ latitude: y, longitude: x }));
  const props = { bottomInset: 80, coverBottom: 300 };
  try {
    await render(props);
    await readyMap();
    const padding = renderer.root.findByType(MapView).props.mapPadding;
    expect(padding.bottom).toBe(80);
    await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    const coordinate = { latitude: 25.001, longitude: 121.001 };
    mockCamera.animateCamera.mockClear();
    await act(async () => renderer.update(<TrackingMap {...defaults} {...props} focusDog={{ key: 1, coordinate }} />));
    expect(renderer.root.findByType(MapView).props.mapPadding.bottom).toBe(80);
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(1);
    // The dog (y 700) goes to the middle of what the card and the bottom row
    // standing on it leave (100…440, 「今天 x km」 / 我的位置 48dp + 12dp),
    // its face and name tag together (2026-10-15: centred on the face alone,
    // above the card only, a tall card left it under 「今天 x km」): y 250, so
    // the camera centre (y 410 in the padded map) moves down by 450.
    expect(mockCamera.coordinateForPoint).toHaveBeenCalledWith({ x: 200, y: 860 });
    expect(mockCamera.animateCamera.mock.calls[0][0]).toEqual({ center: { latitude: 860, longitude: 200 } });
    // The same opening never moves it again (new positions, a re-render).
    await act(async () => renderer.update(<TrackingMap {...defaults} {...props} focusDog={{ key: 1, coordinate }} />));
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(1);
    // A dog already in view above the card — and above the button row and
    // its own name tag (060) — stays where it is.
    point = { x: 200, y: 250 };
    await act(async () => renderer.update(<TrackingMap {...defaults} {...props} focusDog={{ key: 2, coordinate }} />));
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(1);
    // A dog switched to from the card (‹ ›, swipe) always comes to the middle
    // of what the card and its bottom row leave (y 250 with its name tag;
    // this one is there already), even in view; only the centre is set, so
    // the zoom stays the user's.
    await act(async () => renderer.update(<TrackingMap {...defaults} {...props}
      focusDog={{ key: 3, coordinate, always: true }} />));
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(2);
    expect(mockCamera.coordinateForPoint).toHaveBeenLastCalledWith({ x: 200, y: 410 });
    expect(Object.keys(mockCamera.animateCamera.mock.calls[1][0])).toEqual(['center']);
    // The buttons sit above the card.
    expect(renderer.root.findByProps({ testID: 'map-frame-all' })).toBeDefined();
  } finally {
    delete mockCamera.pointForCoordinate;
    delete mockCamera.coordinateForPoint;
  }
});

test('066: a dog tapped with a card open switches the card in one tap (the map tap that comes with it is dropped)', async () => {
  const onMapPress = jest.fn();
  const onDogPress = jest.fn();
  await render({ onMapPress, onDogPress });
  await readyMap();
  const dog = renderer.root.findAll(node => node.type === Marker && node.props.identifier?.startsWith('real-dog-'))[0];
  // Either order: the map tap first, then the marker; or the marker first.
  await act(async () => renderer.root.findByType(MapView).props.onPress());
  await act(async () => dog.props.onPress());
  await act(async () => jest.advanceTimersByTime(600));
  await act(async () => dog.props.onPress());
  await act(async () => jest.advanceTimersByTime(10));
  await act(async () => renderer.root.findByType(MapView).props.onPress());
  await act(async () => jest.advanceTimersByTime(600));
  expect(onDogPress).toHaveBeenCalledTimes(2);
  expect(onMapPress).not.toHaveBeenCalled();
});

test.each(['android', 'ios'])('066: a %s map-only tap on a dog face opens that dog (one tap)', async platform => {
  const { PixelRatio } = require('react-native');
  const ratioMock = jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
  const onMapPress = jest.fn();
  const onDogPress = jest.fn();
  mockCamera.pointForCoordinate = jest.fn(async () => ({ x: 150, y: 300 }));
  try {
    await render({ onMapPress, onDogPress });
    await readyMap();
    await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    await act(async () => jest.advanceTimersByTime(2000));
    Platform.OS = platform;
    const ratio = platform === 'android' ? PixelRatio.get() : 1;
    // On the face (5dp off its centre), in screen pixels as Google reports it.
    await act(async () => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { position: { x: 155 * ratio, y: 300 * ratio } } }));
    await act(async () => jest.advanceTimersByTime(600));
    expect(onDogPress).toHaveBeenCalledWith(7);
    expect(onMapPress).not.toHaveBeenCalled();
    // Empty map further away still closes the card.
    await act(async () => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { position: { x: 300 * ratio, y: 600 * ratio } } }));
    await act(async () => jest.advanceTimersByTime(600));
    expect(onMapPress).toHaveBeenCalledTimes(1);
  } finally {
    delete mockCamera.pointForCoordinate;
    ratioMock.mockRestore();
  }
});

test('a duplicate map hit cannot overwrite the native dog marker identity', async () => {
  const { PixelRatio } = require('react-native');
  const onDogPress = jest.fn();
  const onMapPress = jest.fn();
  const markers = [5, 6].map(slaveId => ({ ...slaveMarker, slaveId,
    coordinate: { latitude: 25, longitude: slaveId }, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}` }));
  mockCamera.pointForCoordinate = jest.fn(async coordinate =>
    ({ x: coordinate.longitude === 5 ? 100 : 200, y: 300 }));
  try {
    await render({ onDogPress, onMapPress, presentation: { ...defaults.presentation, dogMarkers: markers } });
    await readyMap();
    const marker = renderer.root.findAll(node => node.type === Marker && node.props.identifier === 'real-dog-6')[0];
    const duplicateMapHit = () => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { position: { x: 100 * PixelRatio.get(), y: 300 * PixelRatio.get() } } });
    await act(async () => marker.props.onPress());
    await act(async () => duplicateMapHit());
    await act(async () => jest.advanceTimersByTime(600));
    expect(onDogPress.mock.calls).toEqual([[6]]);
    expect(onMapPress).not.toHaveBeenCalled();
    // A later independent map-only hit still selects the dog under it.
    await act(async () => duplicateMapHit());
    expect(onDogPress.mock.calls).toEqual([[6], [5]]);
  } finally { delete mockCamera.pointForCoordinate; }
});

test('bottom dog names share their native face marker and its true-coordinate anchor', async () => {
  const { markerFrame } = require('../src/map/DogMarkerView');
  const onDogPress = jest.fn();
  const markers = [5, 6].map(slaveId => ({ ...slaveMarker, slaveId, size: 48, selected: slaveId === 6,
    coordinate: { latitude: 25.02, longitude: 121.02 }, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}` }));
  mockCamera.pointForCoordinate = jest.fn(async point => ({ x: (point.longitude - 121) * 10000, y: (point.latitude - 25) * 10000 }));
  mockCamera.coordinateForPoint = jest.fn(async point => ({ latitude: 25 + point.y / 10000, longitude: 121 + point.x / 10000 }));
  try {
    await render({ onDogPress, presentation: { ...defaults.presentation, dogMarkers: markers } });
    await readyMap();
    await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    const dogs = renderer.root.findAll(node => node.type === Marker && node.props.identifier?.startsWith('real-dog-'));
    expect(dogs).toHaveLength(2);
    dogs.forEach(dog => expect(dog.props.anchor).toEqual(markerFrame(48).anchor));
    const dog6 = dogs.find(dog => dog.props.identifier === 'real-dog-6');
    await act(async () => dog6.props.onPress());
    expect(onDogPress.mock.calls).toEqual([[6]]);
    dogs.forEach(dog => expect(dog.props.coordinate).toEqual(markers[0].coordinate));
    const label6 = renderer.root.findAllByType(Marker).find(marker =>
      marker.findAllByType(require('react-native').Text).some(text => text.props.children === '狗 6'));
    expect(label6).toBe(dog6);
    await act(async () => label6.props.onPress());
    expect(onDogPress.mock.calls).toEqual([[6], [6]]);
  } finally { delete mockCamera.pointForCoordinate; delete mockCamera.coordinateForPoint; }
});

test('066: 我的位置 with a card open puts the phone in the middle of the map above the card', async () => {
  // 400 × 800, the card covers the bottom 300dp, the map's own padding 80.
  mockCamera.pointForCoordinate = jest.fn(async () => ({ x: 200, y: 700 }));
  mockCamera.coordinateForPoint = jest.fn(async ({ x, y }) => ({ latitude: y, longitude: x }));
  const props = { bottomInset: 80, coverBottom: 300, phoneEnabled: true };
  try {
    await render(props);
    await readyMap();
    await act(async () => renderer.root.findByType(MapView).props.onUserLocationChange({
      nativeEvent: { coordinate: { latitude: 25.002, longitude: 121.002 } } }));
    await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    mockCamera.animateCamera.mockClear();
    await act(async () => renderer.root.findAll(node => node.props.testID === 'map-my-location'
      && typeof node.props.onPress === 'function')[0].props.onPress());
    // As an opened dog: the phone (y 700) goes to the middle above the card
    // and its bottom row (100…440 → 270).
    expect(mockCamera.coordinateForPoint).toHaveBeenCalledWith({ x: 200, y: 840 });
    expect(mockCamera.animateCamera.mock.calls[0][0]).toEqual({ center: { latitude: 840, longitude: 200 } });
  } finally {
    delete mockCamera.pointForCoordinate;
    delete mockCamera.coordinateForPoint;
  }
});

test('dog A then dog B within the hold: a map-only tap on B outside A\'s marker opens B', async () => {
  const { PixelRatio } = require('react-native');
  const { markerFrame } = require('../src/map/DogMarkerView');
  const onDogPress = jest.fn();
  const onMapPress = jest.fn();
  const frame = markerFrame(slaveMarker.size);
  // Dog 5 sits straight above dog 6, just clear of the top of 6's bitmap.
  const sixY = 300;
  const fiveY = sixY - frame.height * frame.anchor.y - slaveMarker.size / 2;
  const markers = [5, 6].map(slaveId => ({ ...slaveMarker, slaveId,
    coordinate: { latitude: 25, longitude: slaveId }, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}` }));
  mockCamera.pointForCoordinate = jest.fn(async coordinate =>
    ({ x: 200, y: coordinate.longitude === 5 ? fiveY : sixY }));
  try {
    await render({ onDogPress, onMapPress, presentation: { ...defaults.presentation, dogMarkers: markers } });
    await readyMap();
    const six = renderer.root.findAll(node => node.type === Marker && node.props.identifier === 'real-dog-6')[0];
    const mapHit = y => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { position: { x: 200 * PixelRatio.get(), y: y * PixelRatio.get() } } });
    await act(async () => six.props.onPress());
    // Google's duplicate of the same touch is still dropped.
    await act(async () => mapHit(sixY));
    expect(onDogPress.mock.calls).toEqual([[6]]);
    // 100 ms later, well inside 2 × MAP_TAP_HOLD_MS, dog 5 reported only as a map tap.
    await act(async () => jest.advanceTimersByTime(100));
    await act(async () => mapHit(fiveY));
    expect(onDogPress.mock.calls).toEqual([[6], [5]]);
    await act(async () => jest.advanceTimersByTime(600));
    expect(onMapPress).not.toHaveBeenCalled();
  } finally { delete mockCamera.pointForCoordinate; }
});

test('a map tap off every dog just after a dog tap is still dropped', async () => {
  const { PixelRatio } = require('react-native');
  const onDogPress = jest.fn();
  const onMapPress = jest.fn();
  mockCamera.pointForCoordinate = jest.fn(async () => ({ x: 150, y: 300 }));
  try {
    await render({ onDogPress, onMapPress });
    await readyMap();
    const dog = renderer.root.findAll(node => node.type === Marker && node.props.identifier?.startsWith('real-dog-'))[0];
    await act(async () => dog.props.onPress());
    await act(async () => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { position: { x: 300 * PixelRatio.get(), y: 600 * PixelRatio.get() } } }));
    await act(async () => jest.advanceTimersByTime(600));
    expect(onDogPress).toHaveBeenCalledTimes(1);
    expect(onMapPress).not.toHaveBeenCalled();
  } finally { delete mockCamera.pointForCoordinate; }
});

test('a tap on the map reaches onMapPress, and the camera heading is reported', async () => {
  const onMapPress = jest.fn();
  const onHeading = jest.fn();
  mockCamera.getCamera.mockResolvedValueOnce({ center: { latitude: 25, longitude: 121 }, heading: 33, zoom: 15 });
  await render({ onMapPress, onHeading });
  await readyMap();
  await act(async () => renderer.root.findByType(MapView).props.onPress());
  // Held back a moment (a dog tap may come with it, 066).
  expect(onMapPress).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(300));
  expect(onMapPress).toHaveBeenCalledTimes(1);
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
  expect(onHeading).toHaveBeenCalledWith(33);
});


// 2026-10-15 (audit): the history opens at once. Whom it shows travels with
// the route; the old history query is stored in the background, and a write
// that hangs (the shared SQLite connection busy) or fails never holds or
// swallows the tap.
describe('看軌跡 and 我的路線 open without waiting for the saved query', () => {
  const tracking = () => ({
    mode: 'real', point: trackingPoint, route: emptyLiveRoute(), ready: { real: true }, errors: {},
    initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
    saveTrackingPreferences: jest.fn(),
  });
  const preferences = { source: 'ble', slaves: [4], masters: [3], dogAliases: {} };
  const open = async history => {
    const onOpenHistory = jest.fn();
    await act(async () => {
      renderer = Renderer.create(<MapScreen tracking={tracking()} phone={{ enabled: true }} bottomInset={80}
        mapProvider={GOOGLE_MAP_PROVIDER} history={history} onOpenHistory={onOpenHistory} />);
    });
    return onOpenHistory;
  };
  const map = () => renderer.root.findAll(node => typeof node.props.onDogPress === 'function', { deep: false })[0];
  const pressTrack = async () => {
    await act(async () => map().props.onDogPress(7));
    await act(async () => renderer.root.findAllByProps({ testID: 'dog-card' })[0]
      .props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
    const track = renderer.root.findAll(node => node.props.testID === 'dog-card-track'
      && typeof node.props.onPress === 'function')[0];
    await act(async () => { track.props.onPress(); });
  };

  test.each([
    ['never finishes', () => new Promise(() => {})],
    ['fails', () => Promise.reject(new Error('database busy'))],
    ['refuses (another save in flight)', () => Promise.resolve(false)],
  ])('看軌跡 opens that dog\'s history when the save %s', async (_, save) => {
    const history = { key: 'k', devices: [{ master: 5, slave: 7 }], preferences, save: jest.fn(save) };
    const onOpenHistory = await open(history);
    await pressTrack();
    expect(onOpenHistory).toHaveBeenCalledWith(7);
    // The query is still stored, in the background.
    expect(history.save).toHaveBeenCalledWith(expect.objectContaining({ slaves: [7], timeMode: 'fixed',
      masters: expect.arrayContaining([5]) }));
  });

  test('看軌跡 opens without any history store at all', async () => {
    const onOpenHistory = await open(undefined);
    await pressTrack();
    expect(onOpenHistory).toHaveBeenCalledWith(7);
  });

  test.each([
    ['never finishes', () => new Promise(() => {})],
    ['fails', () => Promise.reject(new Error('database busy'))],
  ])('「今天 x km」 opens my route when the save %s', async (_, save) => {
    const history = { key: 'k', devices: [], preferences, save: jest.fn(save) };
    const onOpenHistory = await open(history);
    const today = renderer.root.findAll(node => typeof node.props.onToday === 'function')[0];
    await act(async () => { today.props.onToday(); });
    expect(onOpenHistory).toHaveBeenCalledWith(null);
    expect(history.save).toHaveBeenCalledWith(expect.objectContaining({ phone: true, client: false }));
  });
});

test('history route fit and cursor centering use the half-screen panel coverage', async () => {
  const { historyPanelMaxHeight } = require('../src/map/MapPanelHeight');
  const { layout, space, size } = require('../src/theme/tokens');
  const { regionForFrame, overlayFramePadding } = require('../src/map/MapFraming');
  const { historyFramePadding } = require('../src/history/screen/HistoryMapModel');
  const height = historyPanelMaxHeight(800, 24);
  const camera = [{ latitude: 25, longitude: 121 }, { latitude: 25.01, longitude: 121.01 }];
  const props = { ...defaults, topInset: 100, bottomInset: height, coverBottom: height,
    source: 'history:fixed', presentation: { ...defaults.presentation, dogMarkers: [],
      historyRoute: { color: colors.phone, lines: [], places: [], times: [], camera, points: [], cursor: null } } };
  mockCamera.pointForCoordinate = jest.fn().mockResolvedValue({ x: 200, y: 400 });
  mockCamera.coordinateForPoint = jest.fn().mockResolvedValue({ latitude: 25.005, longitude: 121.005 });
  try {
    await render(props);
    await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
      .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    await readyMap();
    expect(renderer.root.findByType(MapView).props.mapPadding.bottom).toBe(height);
    await act(async () => renderer.update(<TrackingMap {...props} historyFrame={{ key: 'frame-fixed' }} />));
    const padding = overlayFramePadding(historyFramePadding(camera, null, {
      top: space.l, right: space.xl, bottom: size.stopMarker.size / 2 + space.s, left: space.xl,
    }), {
      topInset: 100, bottomInset: height, overlayTop: 100, overlayBottom: height,
    });
    expect(mockCamera.animateToRegion).toHaveBeenLastCalledWith(regionForFrame(camera, padding, {
      width: 400 - 2 * layout.floatingGap, height: 800 - 100 - height,
    }), 300);
    // Project the south endpoint from the actual camera request. The full
    // 22dp stop circle must clear the panel by the ordinary 8dp gap, not
    // merely keep its centre visible. This failed with the old 8dp padding.
    const [fittedRegion] = mockCamera.animateToRegion.mock.calls.at(-1);
    const visibleHeight = 800 - 100 - height;
    const southY = visibleHeight / 2 +
      (fittedRegion.latitude - camera[0].latitude) * visibleHeight / fittedRegion.latitudeDelta;
    expect(southY + size.stopMarker.size / 2).toBeLessThanOrEqual(visibleHeight - space.s + 1e-6);
    await act(async () => renderer.update(<TrackingMap {...props}
      historyFocus={{ key: 'cursor-fixed', coordinate: camera[0], centre: true }} />));
    // With SDK padding already applied, the requested point is moved from
    // y=400 to the centre above the panel: (100 + 800 - height) / 2.
    expect(mockCamera.coordinateForPoint).toHaveBeenLastCalledWith({ x: 200, y: 400 });
    expect(mockCamera.animateCamera).toHaveBeenLastCalledWith({
      center: { latitude: 25.005, longitude: 121.005 },
    }, { duration: 220 });
  } finally {
    delete mockCamera.pointForCoordinate;
    delete mockCamera.coordinateForPoint;
  }
});

test.each([
  ['repeated indoor anchor', [{ latitude: 25, longitude: 121 }, { latitude: 25, longitude: 121 }]],
  ['short route', [{ latitude: 25, longitude: 121 }, { latitude: 25.00001, longitude: 121.00001 }]],
])('framing a %s preserves street context above the fixed history panel', async (_name, camera) => {
  const props = { ...defaults, topInset: 100, bottomInset: 388, coverBottom: 388,
    source: 'history:tiny', presentation: { ...defaults.presentation, dogMarkers: [],
      historyRoute: { color: colors.phone, lines: [], places: [], times: [], camera, points: [], cursor: null } } };
  await render(props);
  await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
    .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
  await readyMap();
  await act(async () => renderer.update(<TrackingMap {...props} historyFrame={{ key: 'tiny' }} />));
  const [region] = mockCamera.animateToRegion.mock.calls.at(-1);
  // A held day contains many fixes at one anchor. Its camera must retain a
  // street-sized extent rather than collapsing to a few metres at max zoom.
  expect(region.latitudeDelta).toBeGreaterThan(0.003);
  const centre = (camera[0].latitude + camera[1].latitude) / 2;
  // Region centre includes both header and complete-marker reserves inside
  // the SDK's half-screen viewport. Larger bottom clearance can shift it
  // south slightly; it must remain close to the street centre.
  expect(Math.abs(region.latitude - centre)).toBeLessThan(region.latitudeDelta / 10);
});

test('history framing does not expand a real route beyond the tiny-span threshold', async () => {
  const { regionForFrame } = require('../src/map/MapFraming');
  const { historyFramePadding } = require('../src/history/screen/HistoryMapModel');
  const { layout, space, size } = require('../src/theme/tokens');
  const camera = [{ latitude: 25, longitude: 121 }, { latitude: 25.0005, longitude: 121.0005 }];
  const props = { ...defaults, topInset: 100, bottomInset: 388, coverBottom: 388,
    source: 'history:real-short', presentation: { ...defaults.presentation, dogMarkers: [],
      historyRoute: { color: colors.phone, lines: [], places: [], times: [], camera, points: [], cursor: null } } };
  await render(props);
  await act(async () => renderer.root.findByProps({ testID: 'tracking-map-container' })
    .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
  await readyMap();
  await act(async () => renderer.update(<TrackingMap {...props} historyFrame={{ key: 'real-short' }} />));
  expect(mockCamera.animateToRegion).toHaveBeenLastCalledWith(regionForFrame(camera,
    historyFramePadding(camera, null, { top: space.l, right: space.xl, bottom: size.stopMarker.size / 2 + space.s, left: space.xl }),
    { width: 400 - 2 * layout.floatingGap, height: 312 }), 300);
});

test('resume pill and dog dimming are wired through the live map and clear on finish', async () => {
  const away = trackingPoint.receivedAt + 60000;
  jest.setSystemTime(away + 20 * 60000);
  const tracking = {
    mode: 'real', point: trackingPoint, route: emptyLiveRoute(), ready: { real: true }, errors: {},
    positionSamples: [], initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
    saveTrackingPreferences: jest.fn(), catchUp: { phase: 'catching-up', since: away },
  };
  const screen = value => <MapScreen tracking={value} phone={{ enabled: false }} bottomInset={80}
    mapProvider={GOOGLE_MAP_PROVIDER} />;
  await act(async () => { renderer = Renderer.create(screen(tracking)); });
  const map = () => renderer.root.findByType(TrackingMap);
  expect(renderer.root.findAllByProps({ testID: 'map-catch-up' }).length).toBeGreaterThan(0);
  expect(map().props.presentation.dogMarkers[0]).toMatchObject({ stale: false, dimmed: true });
  const nativeDog = () => renderer.root.findAllByType(Marker)
    .find(node => node.props.identifier === 'real-dog-7');
  expect(nativeDog().props.opacity).toBe(opacity.catchingUp);
  await act(async () => renderer.update(screen({ ...tracking, catchUp: { phase: 'idle', since: null } })));
  expect(renderer.root.findAllByProps({ testID: 'map-catch-up' })).toHaveLength(0);
  expect(map().props.presentation.dogMarkers[0]).toMatchObject({ stale: true, dimmed: false });
  expect(nativeDog().props.opacity).toBe(1);
});

// Window coordinates include ancestor offsets; native press positions are pixels.
async function tapHarness() {
  const points = [{ time: 1, latitude: 25, longitude: 121 }, { time: 2, latitude: 25, longitude: 121.001 }];
  const route = { color: '#1A73E8', lines: [], places: [], times: [], cursor: null, camera: [], points };
  const move = jest.fn(), empty = jest.fn();
  const props = { ...defaults, presentation: { ...defaults.presentation, historyRoute: route },
    onCursorMove: move, onMapPress: empty };
  mockCamera.coordinateForPoint = jest.fn(async () => points[0]);
  mockCamera.pointForCoordinate = jest.fn(async () => ({ x: 40, y: 50 }));
  await act(async () => {
    renderer = Renderer.create(<TrackingMap {...props} />, {
      createNodeMock: () => ({ measure: callback => callback(0, 0, 400, 800, 100, 200) }),
    });
  });
  const surface = () => renderer.root.findAll(node => typeof node.type === 'string' && node.props.onTouchStart)[0].props;
  const refNode = renderer.root.findAll(node => node.props.onTouchStart && node.props.ref?.current)[0];
  refNode.props.ref.current.measure = callback => callback(0, 0, 400, 800, 100, 200);
  const start = (x = 140, y = 250) => surface().onTouchStart({ nativeEvent: { pageX: x, pageY: y, touches: [{}] } });
  const end = () => surface().onTouchEnd({ nativeEvent: {} });
  const press = (x = 40, y = 50) => renderer.root.findByType(MapView).props.onPress({ nativeEvent: {
    coordinate: points[0], position: { x: x * (Platform.OS === 'android' ? require('react-native').PixelRatio.get() : 1), y: y * (Platform.OS === 'android' ? require('react-native').PixelRatio.get() : 1) },
  } });
  return { props, points, move, empty, start, end, press };
}

async function stopTapHarness() {
  const h = await tapHarness();
  const place = { key: 'stop-a', kind: 'stop', number: 1, start: 10,
    coordinate: h.points[0] };
  h.props = { ...h.props, onStopPress: jest.fn(stop => h.move(stop.start, 'stop')),
    presentation: { ...h.props.presentation, historyRoute: {
      ...h.props.presentation.historyRoute, places: [place],
    } } };
  await act(async () => renderer.update(<TrackingMap {...h.props} />));
  h.marker = () => renderer.root.findAllByType(Marker).find(node =>
    node.props.zIndex === 25).props;
  return h;
}

test('a stop marker owns its pending quick tap and the next route tap stays usable', async () => {
  const h = await stopTapHarness();
  let resolve;
  mockCamera.coordinateForPoint.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending;
  await act(async () => { h.start(); pending = h.end(); });
  const stopPropagation = jest.fn();
  await act(async () => h.marker().onPress({ stopPropagation, nativeEvent: { action: 'marker-press' } }));
  await act(async () => { resolve(h.points[0]); await pending; await h.press(); });
  expect(h.move.mock.calls).toEqual([[10, 'stop']]);
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  mockCamera.pointForCoordinate.mockResolvedValue({ x: 200, y: 200 });
  await act(async () => { h.start(300, 400); await h.end(); });
  expect(h.move.mock.calls).toEqual([[10, 'stop'], [1, 'route']]);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('a stop marker invalidates an already pending native route projection', async () => {
  const h = await stopTapHarness();
  let resolve;
  mockCamera.pointForCoordinate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending;
  await act(async () => { h.start(); pending = h.press(); });
  await act(async () => h.marker().onPress({ nativeEvent: { action: 'marker-press' } }));
  await act(async () => { resolve({ x: 40, y: 50 }); await pending; });
  expect(h.move.mock.calls).toEqual([[10, 'stop']]);
  expect(h.empty).not.toHaveBeenCalled();
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('a completed quick route selection yields to the stop and does not block another native-only tap', async () => {
  const h = await stopTapHarness();
  await act(async () => { h.start(); await h.end(); });
  await act(async () => h.marker().onPress({ nativeEvent: { action: 'marker-press' } }));
  await act(async () => { jest.advanceTimersByTime(900); await h.press(); });
  expect(h.move.mock.calls).toEqual([[1, 'route'], [10, 'stop']]);
  await act(async () => h.press(200, 200));
  expect(h.empty).toHaveBeenCalledTimes(1);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('a native marker action is never treated as an ordinary route press', async () => {
  const h = await stopTapHarness();
  await act(async () => renderer.root.findByType(MapView).props.onPress({ nativeEvent: {
    action: 'marker-press', coordinate: h.points[0], position: { x: 40, y: 50 },
  } }));
  expect(h.move).not.toHaveBeenCalled();
  expect(h.empty).not.toHaveBeenCalled();
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('quick tap uses window origin and suppresses only its matching native press', async () => {
  const h = await tapHarness();
  await act(async () => { h.start(); await h.end(); });
  expect(mockCamera.coordinateForPoint).toHaveBeenCalledWith({ x: 40, y: 50 });
  expect(h.move).toHaveBeenCalledTimes(1);
  await act(async () => h.press());
  expect(h.move).toHaveBeenCalledTimes(1);
  await act(async () => h.press(200, 200));
  expect(h.empty).toHaveBeenCalledTimes(1);
  await act(async () => { h.start(300, 400); await h.end(); await h.press(200, 200); });
  expect(h.empty).toHaveBeenCalledTimes(2);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('native press claims a pending quick tap and stale projections cannot move the cursor', async () => {
  const h = await tapHarness();
  let resolve;
  mockCamera.coordinateForPoint.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending;
  await act(async () => { h.start(); pending = h.end(); });
  await act(async () => h.press());
  expect(h.move).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(h.points[0]); await pending; });
  expect(h.move).toHaveBeenCalledTimes(1);
  mockCamera.coordinateForPoint.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { h.start(); pending = h.end(); });
  await act(async () => h.start(300, 400));
  await act(async () => { resolve(h.points[0]); await pending; });
  expect(h.move).toHaveBeenCalledTimes(1);
  mockCamera.coordinateForPoint.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { h.start(); pending = h.end(); });
  await act(async () => renderer.update(<TrackingMap {...h.props} presentation={{ ...h.props.presentation,
    historyRoute: { ...h.props.presentation.historyRoute, points: h.points.map(p => ({ ...p, latitude: p.latitude + 0.01 })) } }} />));
  await act(async () => { resolve(h.points[0]); await pending; });
  expect(h.move).toHaveBeenCalledTimes(1);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('a native projection from an older gesture cannot dismiss or move a newer selection', async () => {
  const h = await tapHarness();
  let resolve;
  mockCamera.pointForCoordinate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending;
  await act(async () => { h.start(); pending = h.press(); });
  await act(async () => h.start(300, 400));
  await act(async () => { resolve({ x: 40, y: 50 }); await pending; });
  expect(h.move).not.toHaveBeenCalled();
  expect(h.empty).not.toHaveBeenCalled();
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('a delayed matching native report cannot handle an owned gesture twice', async () => {
  const h = await tapHarness();
  await act(async () => { h.start(); await h.end(); });
  await act(async () => jest.advanceTimersByTime(900));
  await act(async () => h.press());
  expect(h.move).toHaveBeenCalledTimes(1);
  expect(h.empty).not.toHaveBeenCalled();
  // A fresh gesture at the same location is a separate tap.
  await act(async () => { h.start(); await h.end(); await h.press(); });
  expect(h.move).toHaveBeenCalledTimes(2);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('equal geometry rebuilt during a pending tap keeps the gesture valid', async () => {
  const h = await tapHarness();
  let resolve;
  mockCamera.coordinateForPoint.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending;
  await act(async () => { h.start(); pending = h.end(); });
  await act(async () => renderer.update(<TrackingMap {...h.props} presentation={{ ...h.props.presentation,
    historyRoute: { ...h.props.presentation.historyRoute, points: h.points.map(p => ({ ...p })) } }} />));
  await act(async () => { resolve(h.points[0]); await pending; });
  expect(h.move).toHaveBeenCalledTimes(1);
  await act(async () => h.press());
  expect(h.move).toHaveBeenCalledTimes(1);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('invalid touch or projection coordinates never select a route', async () => {
  const h = await tapHarness();
  await act(async () => { h.start(undefined, NaN); await h.end(); });
  expect(mockCamera.coordinateForPoint).not.toHaveBeenCalled();
  mockCamera.pointForCoordinate.mockResolvedValueOnce({ x: NaN, y: 50 });
  await act(async () => { h.start(); await h.end(); });
  expect(h.move).not.toHaveBeenCalled();
  await act(async () => h.press());
  expect(h.move).toHaveBeenCalledTimes(1);
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('iOS native press positions are points rather than Android pixels', async () => {
  const h = await tapHarness();
  Platform.OS = 'ios';
  const ratio = jest.spyOn(require('react-native').PixelRatio, 'get').mockReturnValue(3);
  await act(async () => { h.start(); await h.end(); await h.press(); });
  expect(h.move).toHaveBeenCalledTimes(1);
  expect(h.empty).not.toHaveBeenCalled();
  ratio.mockRestore();
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test('native press uses the route current at start but discards a later route change', async () => {
  const h = await tapHarness();
  const change = async offset => renderer.update(<TrackingMap {...h.props} presentation={{ ...h.props.presentation,
    historyRoute: { ...h.props.presentation.historyRoute,
      points: h.points.map(p => ({ ...p, longitude: p.longitude + offset })) } }} />);
  await act(async () => h.start());
  await act(async () => change(0.00001));
  await act(async () => h.press());
  expect(h.move).toHaveBeenCalledTimes(1);
  await act(async () => h.start());
  let resolve;
  mockCamera.pointForCoordinate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending;
  await act(async () => { pending = h.press(); });
  await act(async () => change(0.00002));
  await act(async () => { resolve({ x: 40, y: 50 }); await pending; });
  expect(h.move).toHaveBeenCalledTimes(1);
  expect(h.empty).not.toHaveBeenCalled();
  delete mockCamera.coordinateForPoint;
  delete mockCamera.pointForCoordinate;
});

test.each(['background', 'owner'])('automatic recovery map-read memory is cleared on %s change', async change => {
  const tracking = {
    mode: 'real', point: trackingPoint, route: emptyLiveRoute(), ready: { real: true }, errors: {},
    initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
  };
  const sync = { foreground: true, mapSuccessRevision: 0, lastDownloadAt: null,
    catchUp: { phase: 'failed', since: 1000 } };
  const dogs = { rows: [], packets: [], track: [], holds: {}, statuses: {}, ranges: {}, cloudCommit: null };
  const screen = (cloudOwner, cloudSync) => <MapScreen tracking={tracking} phone={{ enabled: false }}
    cloudOwner={cloudOwner} cloudSync={cloudSync} cloudDogs={dogs} mapProvider={GOOGLE_MAP_PROVIDER} />;
  await act(async () => { renderer = Renderer.create(screen('a', sync)); });
  const success = { ...sync, catchUp: { phase: 'idle', since: null }, mapSuccessRevision: 1,
    lastDownloadAt: 61000, lastSuccess: 61001 };
  await act(async () => renderer.update(screen('a', success)));
  expect(renderer.root.findByType(TrackingMap).props.presentation.dogMarkers[0].dimmed).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('正在更新狗的位置');
  await act(async () => renderer.update(screen(change === 'owner' ? 'b' : 'a', {
    ...success, foreground: change !== 'background',
  })));
  expect(renderer.root.findAllByProps({ testID: 'map-catch-up' })).toHaveLength(0);
  expect(renderer.root.findByType(TrackingMap).props.presentation.dogMarkers.every(dog => !dog.dimmed)).toBe(true);
});


test('initial snapshot wait retains the surface but cannot report old projected dog targets for a replacement scope', async () => {
  const splash = require('../src/app/hideSplash');
  await act(async () => splash.resetSplashGate());
  const first = {}, second = {};
  await act(async () => { splash.reportInitialLatest(first, 'waiting'); splash.launchInto('map'); });
  await render({ coldStartReady: false, coldStartScope: first, dataReady: false });
  expect(renderer.root.findAllByType(MapView)).toHaveLength(0);
  // Past the map's own framing deadline, short of the launch's cap.
  await act(async () => jest.advanceTimersByTime(splash.LAUNCH_HANDOVER_CAP_MS - 1500));
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => {
    splash.reportInitialLatest(first, 'accepted');
    renderer.update(<TrackingMap {...defaults} coldStartReady coldStartScope={first} />);
  });
  const original = renderer.root.findByType(MapView);
  const projections = [];
  mockCamera.pointForCoordinate = jest.fn(() => new Promise(resolve => { projections.push(resolve); }));
  await readyMap();
  await act(async () => original.props.onRegionChangeComplete({}, {}));
  expect(projections.length).toBeGreaterThan(0);
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => {
    splash.reportInitialLatest(second, 'waiting');
    renderer.update(<TrackingMap {...defaults} coldStartReady={false} coldStartScope={second} dataReady={false} framingReady={false} />);
  });
  expect(renderer.root.findByType(MapView)).toBe(original);
  await act(async () => { projections.forEach(resolve => resolve({ x: 120, y: 200 })); });
  mockCamera.pointForCoordinate.mockImplementation(async () => ({ x: 120, y: 200 }));
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => splash.reportInitialLatest(second, 'accepted'));
  // An old projection must not have set the new map's framing condition.
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => {
    renderer.update(<TrackingMap {...defaults} coldStartReady coldStartScope={second} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, {}));
  expect(splash.getSplashState().phase).toBe('handover');
  delete mockCamera.pointForCoordinate;
  await act(async () => renderer.unmount()); renderer = null;
  splash.resetSplashGate();
});

test('cold fallback gate is registered before a child synchronously reports its unavailable-map frame', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate();
  const previous = {}, publication = { owner: 'a', scope: {}, generation: 1, mapSuccessRevision: 0 };
  splash.reportInitialLatest(previous, 'waiting'); splash.launchInto('map');
  NativePlatform.isMapConfigured.mockReturnValue(false);
  function ColdMap() {
    const latest = useInitialLatest({ screen: 'map', owner: 'a', dogs: {},
      sync: { error: 'unavailable', getMapPublication: () => publication } });
    return <TrackingMap {...defaults} coldStartReady={latest.ready} coldStartScope={latest.frameScope} />;
  }
  await act(async () => { renderer = Renderer.create(<ColdMap />); });
  expect(splash.getSplashState().phase).toBe('handover');
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('offline cold map frames only after native ready, same-instance positive layout and load timeout, without requiring tiles', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate(); const scope = {};
  splash.reportInitialLatest(scope, 'fallback'); splash.launchInto('map');
  await render({ coldStartReady: true, coldStartScope: scope, framingReady: false });
  const map = renderer.root.findByType(MapView);
  await act(async () => map.props.onLayout?.({ nativeEvent: { layout: { width: 400, height: 800 } } }));
  await act(async () => jest.advanceTimersByTime(15000));
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
  await act(async () => map.props.onMapReady());
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => renderer.update(<TrackingMap {...defaults} coldStartReady coldStartScope={scope} />));
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(250));
  expect(splash.getSplashState().phase).toBe('handover');
  expect(defaults.onMapState).toHaveBeenLastCalledWith('load-failed');
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('already framed cold map does not stay covered forever when native dog target projection never settles', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate(); const scope = {};
  splash.reportInitialLatest(scope, 'fallback'); splash.launchInto('map');
  mockCamera.pointForCoordinate = jest.fn(() => new Promise(() => {}));
  await render({ coldStartReady: true, coldStartScope: scope });
  await readyMap();
  expect(mockCamera.fitToCoordinates).toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(250));
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => jest.advanceTimersByTime(3000));
  expect(splash.getSplashState().phase).toBe('handover');
  expect(splash.getSplashState().mode).toBe('fade');
  delete mockCamera.pointForCoordinate;
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('offline cold framing rejects zero bounds and stale layout from a replaced native map', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate(); const scope = {};
  splash.reportInitialLatest(scope, 'fallback'); splash.launchInto('map');
  await render({ coldStartReady: true, coldStartScope: scope });
  const first = renderer.root.findByType(MapView);
  const oldLayout = first.props.onLayout;
  await act(async () => first.props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
  await act(async () => renderer.update(<TrackingMap {...defaults} coldStartReady coldStartScope={scope} retryKey={1} />));
  const current = renderer.root.findByType(MapView);
  await act(async () => {
    oldLayout({ nativeEvent: { layout: { width: 400, height: 800 } } });
    current.props.onLayout({ nativeEvent: { layout: { width: 0, height: 800 } } });
    current.props.onMapReady();
  });
  await act(async () => jest.advanceTimersByTime(18000));
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => current.props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(250));
  expect(splash.getSplashState().phase).toBe('handover');
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('old cold projection timeout cannot frame a replacement scope; its new framing still respects the launch link', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate(); const first = {}, next = {};
  splash.reportInitialLatest(first, 'fallback'); splash.launchInto('map');
  mockCamera.pointForCoordinate = jest.fn(() => new Promise(() => {}));
  await render({ coldStartReady: true, coldStartScope: first });
  await readyMap();
  await act(async () => jest.advanceTimersByTime(250));
  await act(async () => {
    splash.reportInitialLatest(next, 'waiting');
    renderer.update(<TrackingMap {...defaults} coldStartReady={false} coldStartScope={next} framingReady={false} />);
  });
  await act(async () => jest.advanceTimersByTime(3000));
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => splash.reportInitialLatest(next, 'fallback'));
  // A late old timeout must not have silently filled this new frame's gate.
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => {
    splash.awaitInitialLink();
    renderer.update(<TrackingMap {...defaults} coldStartReady coldStartScope={next} />);
  });
  // The normal initial-link deadline is independent; keep it unread during
  // this target deadline rather than treating projection as a release override.
  await act(async () => jest.advanceTimersByTime(250));
  expect(splash.getSplashState().phase).toBe('waiting');
  delete mockCamera.pointForCoordinate;
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('cold start: the map mounts and loads under the launch screen while latest is still coming, and frames only once it is accepted', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate(); const scope = {};
  splash.reportInitialLatest(scope, 'waiting'); splash.launchInto('map');
  await render({ coldStartReady: false, coldStartScope: scope, framingReady: false });
  // Mounted at once (no longer after latest): tiles load in the meantime.
  const map = renderer.root.findByType(MapView);
  await readyMap();
  await act(async () => map.props.onRegionChangeComplete({}, {}));
  await act(async () => jest.advanceTimersByTime(9000));
  // Nothing framed or released on the positions from before latest.
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => {
    splash.reportInitialLatest(scope, 'accepted');
    renderer.update(<TrackingMap {...defaults} coldStartReady coldStartScope={scope} />);
  });
  expect(renderer.root.findByType(MapView)).toBe(map);
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
  expect(mockCamera.fitToCoordinates.mock.calls[0][0]).toEqual(defaults.presentation.cameraPositions);
  expect(splash.getSplashState().phase).toBe('waiting');
  await act(async () => jest.advanceTimersByTime(250));
  expect(splash.getSplashState().phase).toBe('handover');
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('cold start: mounted on earlier positions, latest accepted with nothing to frame opens on the default view', async () => {
  const splash = require('../src/app/hideSplash');
  splash.resetSplashGate(); const scope = {};
  splash.reportInitialLatest(scope, 'waiting'); splash.launchInto('map');
  await render({ coldStartReady: false, coldStartScope: scope, framingReady: false });
  expect(renderer.root.findByType(MapView).props.initialRegion).toMatchObject(master.coordinate);
  await readyMap();
  const empty = { ...defaults.presentation, cameraPositions: [], dogMarkers: [] };
  await act(async () => {
    splash.reportInitialLatest(scope, 'accepted');
    renderer.update(<TrackingMap {...defaults} presentation={empty} coldStartReady coldStartScope={scope} />);
  });
  expect(mockCamera.animateToRegion).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 23.7, longitude: 121, latitudeDelta: 4 }), 0);
  expect(splash.getSplashState().phase).toBe('waiting');
  // Everything it waits for is known: released once the view is drawn.
  await act(async () => jest.advanceTimersByTime(250));
  expect(splash.getSplashState()).toMatchObject({ phase: 'handover', mode: 'fade' });
  await act(async () => renderer.unmount()); renderer = null; splash.resetSplashGate();
});

test('a native tap on overlapping dog markers opens the dog drawn under the finger', async () => {
  const onDogPress = jest.fn();
  // Zoomed in: dog 108 right under dog 104, its face over 104's name tag.
  const markers = [[104, 25.0002], [108, 25.0001]].map(([slaveId, latitude]) => ({ ...slaveMarker, slaveId,
    name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, label: `狗 ${slaveId}`, coordinate: { latitude, longitude: 121 } }));
  mockCamera.pointForCoordinate = jest.fn(async p => ({ x: 100, y: p.latitude > 25.00015 ? 100 : 140 }));
  mockCamera.getCamera.mockResolvedValue({ center: markers[0].coordinate, heading: 0, zoom: 19 });
  try {
    await act(async () => {
      renderer = Renderer.create(<TrackingMap {...defaults} onDogPress={onDogPress}
        presentation={{ ...defaults.presentation, dogMarkers: markers, slaveSegments: [], rangeRing: null }} />, {
        createNodeMock: () => ({ measure: callback => callback(0, 0, 400, 800, 10, 20) }),
      });
    });
    await readyMap();
    await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
    for (let i = 0; i < 5; i++) await act(async () => jest.advanceTimersByTime(400));
    const face = id => renderer.root.findAll(node => node.type === Marker && node.props.identifier === `real-dog-${id}`)[0];
    // Every dog its own zIndex; the lower one drawn on top.
    expect(face(108).props.zIndex).toBeGreaterThan(face(104).props.zIndex);
    const surface = renderer.root.findAll(node => typeof node.type === 'string' && node.props.onTouchStart)[0];
    renderer.root.findAll(node => node.props.onTouchStart && node.props.ref?.current)[0]
      .props.ref.current.measure = callback => callback(0, 0, 400, 800, 10, 20);
    const touch = (x, y) => surface.props.onTouchStart({ nativeEvent: { pageX: x + 10, pageY: y + 20, touches: [{}] } });
    // Google picked 104 (its tag canvas) for a finger on 108's face.
    await act(async () => touch(100, 140));
    await act(async () => face(104).props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(108);
    // Google picked 108 (its empty canvas) for a finger on 104's name tag.
    await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => touch(75, 125));
    await act(async () => face(108).props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(104);
    // No recent touch (TalkBack, a stale finger): Google's pick stands.
    await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => face(104).props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(104);
    await act(async () => face(108).props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(108);
  } finally {
    delete mockCamera.pointForCoordinate;
    mockCamera.getCamera.mockResolvedValue(null);
  }
});

test('a tap on a marker\'s empty canvas beside a dog is an empty-map tap: it closes the card, opens no dog', async () => {
  const onDogPress = jest.fn();
  const onMapPress = jest.fn();
  // Two dogs far apart; Google's marker canvas is 174dp wide, so a finger
  // 60dp beside dog 4's face (on bare map) is still reported as its marker.
  const markers = [[4, 121], [9, 121.01]].map(([slaveId, longitude]) => ({ ...slaveMarker, slaveId,
    name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, label: `狗 ${slaveId}`, coordinate: { latitude: 25, longitude } }));
  mockCamera.pointForCoordinate = jest.fn(async p => ({ x: p.longitude > 121.005 ? 300 : 100, y: 200 }));
  mockCamera.getCamera.mockResolvedValue({ center: markers[0].coordinate, heading: 0, zoom: 17 });
  try {
    await act(async () => {
      renderer = Renderer.create(<TrackingMap {...defaults} onDogPress={onDogPress} onMapPress={onMapPress}
        presentation={{ ...defaults.presentation, dogMarkers: markers, slaveSegments: [], rangeRing: null }} />, {
        createNodeMock: () => ({ measure: callback => callback(0, 0, 400, 800, 10, 20) }),
      });
    });
    await readyMap();
    await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
    for (let i = 0; i < 5; i++) await act(async () => jest.advanceTimersByTime(400));
    const face = id => renderer.root.findAll(node => node.type === Marker && node.props.identifier === `real-dog-${id}`)[0];
    const surface = renderer.root.findAll(node => typeof node.type === 'string' && node.props.onTouchStart)[0];
    renderer.root.findAll(node => node.props.onTouchStart && node.props.ref?.current)[0]
      .props.ref.current.measure = callback => callback(0, 0, 400, 800, 10, 20);
    const touch = (x, y) => surface.props.onTouchStart({ nativeEvent: { pageX: x + 10, pageY: y + 20, touches: [{}] } });
    // Beside the face, on bare map: the card closes, no dog opens.
    const ratio = require('react-native').PixelRatio.get();
    await act(async () => touch(160, 200));
    await act(async () => face(4).props.onPress());
    // Android's own map event for the same marker click comes at the
    // marker's anchor (dog 4's face): it must not open dog 4 again.
    await act(async () => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { action: 'marker-press', position: { x: 100 * ratio, y: 200 * ratio } } }));
    await act(async () => jest.advanceTimersByTime(600));
    expect(onDogPress).not.toHaveBeenCalled();
    expect(onMapPress).toHaveBeenCalledTimes(1);
    // On the face itself it is that dog (with a card open: the card switches).
    await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => touch(100, 200));
    await act(async () => face(4).props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(4);
    // Another dog's face: that dog.
    await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => touch(300, 200));
    await act(async () => face(9).props.onPress());
    expect(onDogPress).toHaveBeenLastCalledWith(9);
    // A plain map tap far from every dog still closes it (after the hold).
    await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => renderer.root.findByType(MapView).props.onPress({ nativeEvent:
      { position: { x: 200 * require('react-native').PixelRatio.get(), y: 600 * require('react-native').PixelRatio.get() } } }));
    await act(async () => jest.advanceTimersByTime(600));
    expect(onMapPress).toHaveBeenCalledTimes(2);
    expect(onDogPress).toHaveBeenCalledTimes(2);
  } finally {
    delete mockCamera.pointForCoordinate;
    mockCamera.getCamera.mockResolvedValue(null);
  }
});

// 2026-10-16: switching the card's dog drew every dog marker again (new
// marker objects from the same dogs); only the dogs whose look changed are.
test('a dog marker draws again only when what it shows changes', async () => {
  const DogMarkerView = require('../src/map/DogMarkerView').default;
  const other = { ...slaveMarker, slaveId: 8, name: '狗 8', tag: '狗 8', label: '狗 8',
    coordinate: { latitude: 25.002, longitude: 121.002 } };
  const onDogPress = jest.fn();
  const shown = () => Object.fromEntries(renderer.root.findAllByType(DogMarkerView)
    .map(view => [view.props.marker.slaveId, view.props]));
  await render({ presentation: { ...defaults.presentation, dogMarkers: [slaveMarker, other] }, onDogPress });
  await readyMap();
  const before = shown();
  await act(async () => renderer.update(<TrackingMap {...defaults} onDogPress={onDogPress}
    presentation={{ ...defaults.presentation,
      dogMarkers: [{ ...slaveMarker, selected: true }, { ...other, coordinate: { ...other.coordinate } }] }} />));
  const after = shown();
  expect(after[8]).toBe(before[8]);
  expect(after[7]).not.toBe(before[7]);
  expect(after[7].marker.selected).toBe(true);
});
