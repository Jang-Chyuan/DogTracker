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
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import MapScreen from '../src/screens/MapScreen';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { cameraCoordinates } from '../src/map/TrackingGeometry';
import { receiverRangeRing } from '../src/map/TrackingMapPresentation';
import { distanceMeters } from '../src/tracking/ReceiverRange';
import { colors, opacity } from '../src/theme/tokens';
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
  onStatus: jest.fn(),
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
  expect(defaults.onStatus).toHaveBeenLastCalledWith(null);
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
test('enables the native Google compass without adding a phone location button', async () => {
  await render();
  const map = renderer.root.findByType(MapView);
  expect(map.props.showsCompass).toBe(true);
  expect(map.props.rotateEnabled).toBe(true);
  expect(map.props.pitchEnabled).toBe(true);
  expect(map.props.showsMyLocationButton).toBe(false);
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
test('missing key never mounts native map and gives an explicit fallback message', async () => {
  NativePlatform.isMapConfigured.mockReturnValue(false);
  await render();
  expect(renderer.root.findAllByType(MapView)).toHaveLength(0);
  expect(defaults.onStatus).toHaveBeenLastCalledWith(
    expect.stringContaining('未設定'),
  );
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

test('without a phone fix 我的位置 is grey, moves nothing and says 手機沒有定位', async () => {
  // A fix older than 10 minutes is no fix.
  await render({ livePhone: { running: true, ageSeconds: 601, position: { latitude: 24.9, longitude: 121.2, accuracy: 5, timestamp: Date.now() - 601000 } } });
  await readyMap();
  mockCamera.animateCamera.mockClear();
  const glyphColor = () => renderer.root.find(node => node.props.testID === 'map-my-location')
    .findAll(node => node.props.name === 'locate')[0].props.color;
  expect(glyphColor()).toBe(colors.iconMuted);
  await pressLabel('我的位置');
  expect(mockCamera.animateCamera).not.toHaveBeenCalled();
  const tips = () => renderer.root.findAll(node => node.props.testID === 'map-tip' && typeof node.type !== 'string');
  expect(tips().length).toBeGreaterThan(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('"手機沒有定位"]');
  // Gone after 5 seconds.
  await act(async () => jest.advanceTimersByTime(5000));
  expect(renderer.root.findAll(node => node.props.testID === 'map-tip')).toHaveLength(0);
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
    presentation={{ ...defaults.presentation, historyTracks: [] }} />));
  expect(renderer.root.findAll(node => node.props.testID === 'map-frame-all')).toHaveLength(0);
});

test('the launch screen goes only after the first framing is drawn, or after a wait with nothing to frame', async () => {
  const { NativeModules } = require('react-native');
  NativeModules.AppSplash = { hide: jest.fn() };
  try {
    await render({ framingReady: false });
    await readyMap();
    // Loaded but not framed: the launch screen stays, however long the
    // framing takes (with something to frame the wait is not cut short).
    await act(async () => jest.advanceTimersByTime(5000));
    expect(NativeModules.AppSplash.hide).not.toHaveBeenCalled();
    await act(async () => renderer.update(<TrackingMap {...defaults} framingReady />));
    expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(1);
    expect(NativeModules.AppSplash.hide).not.toHaveBeenCalled();
    // The fitted camera is reported drawn.
    await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, {}));
    expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
    renderer = null;
    NativeModules.AppSplash.hide.mockClear();
    // Nothing to frame: released after FIRST_FRAME_WAIT_MS.
    await render({ presentation: { ...defaults.presentation, cameraPositions: [], dogMarkers: [] } });
    await readyMap();
    expect(NativeModules.AppSplash.hide).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(3000));
    expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);
  } finally {
    delete NativeModules.AppSplash;
  }
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
  expect(JSON.stringify(renderer.toJSON())).toContain('看軌跡');
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
  expect(defaults.onStatus.mock.calls.every(([value]) => value === null)).toBe(
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

  test('dogs off the left get one hint; tapping it frames them', async () => {
    const markers = [at(4, 25.005, 121.002), at(6, 25.005, 120.99, { problem: true, size: 48 }),
      at(8, 25.004, 120.98)];
    await render({ presentation: { ...defaults.presentation, dogMarkers: markers } });
    await layout();
    await readyMap();
    const hints = renderer.root.findAll(node => node.props.testID === 'edge-hint-left' && node.props.onPress);
    expect(hints).toHaveLength(1);
    expect(hints[0].props.accessibilityLabel).toBe('左邊畫面外有 2 隻狗：狗 6、狗 8，其中狗 6有問題，點兩下移過去');
    expect(renderer.root.findAll(node => node.props.testID === 'edge-hint-face-problem'
      && typeof node.type === 'string')).toHaveLength(1);
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
    expect(left()).toHaveLength(1);
  });

  test('tapping the face carrying 「3 隻」 opens the menu; picking a dog opens it; outside closes', async () => {
    const onDogPress = jest.fn();
    const markers = [at(4, 25.005, 121.002), at(6, 25.00501, 121.0021, { problem: true, size: 48,
      note: { text: '電量 12%・偏低', level: 'crit' } }), at(8, 25.00499, 121.0019)];
    await render({ onDogPress, presentation: { ...defaults.presentation, dogMarkers: markers } });
    await layout();
    await readyMap();
    const lead = renderer.root.findAll(node => node.type === Marker && node.props.identifier?.startsWith('real-dog-')
      && /^3 隻/.test(node.props.children.props.accessibilityLabel || ''));
    expect(lead).toHaveLength(1);
    expect(lead[0].props.children.props.accessibilityLabel).toBe('3 隻：狗 6、狗 4、狗 8，點兩下選一隻');
    await act(async () => lead[0].props.onPress());
    expect(onDogPress).not.toHaveBeenCalled();
    const rows = () => renderer.root.findAll(node => /^overlap-row-\d+$/.test(node.props.testID || '')
      && node.props.onPress);
    expect(rows().map(node => node.props.accessibilityLabel)).toEqual(['狗 6，電量 12%・偏低', '狗 4', '狗 8']);
    await act(async () => rows()[1].props.onPress());
    expect(onDogPress).toHaveBeenCalledWith(4);
    expect(rows()).toHaveLength(0);
    await act(async () => lead[0].props.onPress());
    await act(async () => renderer.root.find(node => node.props.testID === 'overlap-picker-outside'
      && node.props.onPress).props.onPress());
    expect(rows()).toHaveLength(0);
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
    // The dog (y 700) goes to the middle of what the card leaves (100…500 →
    // 300): the camera centre (y 410 in the padded map) moves down by 400.
    expect(mockCamera.coordinateForPoint).toHaveBeenCalledWith({ x: 200, y: 810 });
    expect(mockCamera.animateCamera.mock.calls[0][0]).toEqual({ center: { latitude: 810, longitude: 200 } });
    // The same opening never moves it again (new positions, a re-render).
    await act(async () => renderer.update(<TrackingMap {...defaults} {...props} focusDog={{ key: 1, coordinate }} />));
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(1);
    // A dog already in view above the card stays where it is.
    point = { x: 200, y: 300 };
    await act(async () => renderer.update(<TrackingMap {...defaults} {...props} focusDog={{ key: 2, coordinate }} />));
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(1);
    // The buttons sit above the card.
    expect(renderer.root.findByProps({ testID: 'map-frame-all' })).toBeDefined();
  } finally {
    delete mockCamera.pointForCoordinate;
    delete mockCamera.coordinateForPoint;
  }
});

test('a tap on the map reaches onMapPress, and the camera heading is reported', async () => {
  const onMapPress = jest.fn();
  const onHeading = jest.fn();
  mockCamera.getCamera.mockResolvedValueOnce({ center: { latitude: 25, longitude: 121 }, heading: 33, zoom: 15 });
  await render({ onMapPress, onHeading });
  await readyMap();
  await act(async () => renderer.root.findByType(MapView).props.onPress());
  expect(onMapPress).toHaveBeenCalledTimes(1);
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
  expect(onHeading).toHaveBeenCalledWith(33);
});

