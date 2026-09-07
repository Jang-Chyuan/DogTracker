import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet, Switch } from 'react-native';
import MapView, {
  Circle,
  Marker,
  Polyline,
  mockCamera,
} from 'react-native-maps';
import NativePlatform from '../specs/NativeTrackingPlatform';
import TrackingMap, { MAP_LOAD_TIMEOUT_MS } from '../src/map/TrackingMap';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import MapScreen from '../src/screens/MapScreen';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { cameraCoordinates } from '../src/map/TrackingGeometry';
const master = {
  coordinate: { latitude: 25, longitude: 121 },
  retained: false,
};
const slave = {
  coordinate: { latitude: 25.001, longitude: 121.001 },
  retained: true,
};
const defaults = {
  source: 'real',
  presentation: {
    master,
    slave,
    cameraPositions: cameraCoordinates(master, slave),
    masterSegments: [],
    slaveSegments: [[master.coordinate, slave.coordinate]],
    masterRangeMeters: 1000,
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
test('Google provider, DB markers, dog trail and exactly 1000 metre circle', async () => {
  await render();
  expect(renderer.root.findByType(MapView).props.provider).toBe('google');
  expect(
    renderer.root.findAllByType(Marker).map(node => node.props.coordinate),
  ).toEqual([master.coordinate, slave.coordinate]);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(1);
  expect(renderer.root.findByType(Circle).props.radius).toBe(1000);
  expect(renderer.root.findByType(Circle).props.center).toEqual(
    master.coordinate,
  );
  expect(renderer.root.findAllByType(Marker)[1].props.description).toContain(
    '非最新定位',
  );
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
      masterSegments: [[master.coordinate, slave.coordinate]],
    },
  });
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(2);
  await act(async () =>
    renderer.update(
      <TrackingMap
        {...defaults}
        source="demo"
        presentation={{
          master: null,
          slave: null,
          masterSegments: [],
          slaveSegments: [],
          masterRangeMeters: 1000,
          cameraPositions: [],
        }}
      />,
    ),
  );
  expect(renderer.root.findAllByType(Marker)).toHaveLength(0);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
});

test('switching data source reuses the native map and reframes the new source', async () => {
  await render();
  await readyMap();
  const nativeMap = renderer.root.findByType(MapView);
  const fits = mockCamera.fitToCoordinates.mock.calls.length;
  expect(fits).toBe(0);
  await act(async () =>
    renderer.update(
      <TrackingMap
        {...defaults}
        source="demo"
        provider={GOOGLE_MAP_PROVIDER}
      />,
    ),
  );
  expect(renderer.root.findByType(MapView)).toBe(nativeMap);
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(fits + 1);
});
test('missing key never mounts native map and gives an explicit fallback message', async () => {
  NativePlatform.isMapConfigured.mockReturnValue(false);
  await render();
  expect(renderer.root.findAllByType(MapView)).toHaveLength(0);
  expect(defaults.onStatus).toHaveBeenLastCalledWith(
    expect.stringContaining('未設定'),
  );
});
test('ready does not imply tiles loaded; timeout, retry and late recovery remain distinct', async () => {
  await render();
  expect(renderer.root.findByType(MapView).props.mapPadding).toBeUndefined();
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  expect(renderer.root.findByType(MapView).props.mapPadding).toMatchObject({
    bottom: 300,
  });
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
  expect(defaults.onStatus).toHaveBeenLastCalledWith(
    expect.stringContaining('尚未載入完成'),
  );
  await act(async () =>
    renderer.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '重試載入地圖' &&
          typeof node.props.onPress === 'function',
      )[0]
      .props.onPress(),
  );
  expect(defaults.onStatus).toHaveBeenLastCalledWith(null);
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  expect(defaults.onStatus).toHaveBeenLastCalledWith(null);
});
test('late SDK events from a replaced map cannot mark the new map ready', async () => {
  await render();
  const oldEvents = renderer.root.findByType(MapView).props;
  await act(async () => jest.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
  await act(async () =>
    renderer.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '重試載入地圖' &&
          typeof node.props.onPress === 'function',
      )[0]
      .props.onPress(),
  );
  await act(async () => {
    oldEvents.onMapReady();
    oldEvents.onMapLoaded();
  });
  expect(renderer.root.findByType(MapView).props.mapPadding).toBeUndefined();
  expect(defaults.onStatus).toHaveBeenLastCalledWith(null);
});
test('new DB rows never refit the camera after panning', async () => {
  await render();
  await readyMap();
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
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
test('map starts collapsed, the sheet owns visibility controls and Master details contain information only', async () => {
  const tracking = {
    mode: 'real',
    point: trackingPoint,
    route: emptyLiveRoute(),
    ready: { real: true },
    errors: { real: 'locked' },
    historyLoaded: true,
    foreground: true,
    preferences: {
      ready: true,
      busy: false,
      value: DEFAULT_TRACKING_PREFERENCES,
    },
    saveTrackingPreferences: jest.fn(),
  };
  await act(async () => {
    renderer = Renderer.create(
      <MapScreen
        tracking={tracking}
        alerts={{ status: 'fresh' }}
        phone={{ enabled: true, permission: 'precise' }}
        onDemo={jest.fn()}
        bottomInset={80}
        mapProvider={GOOGLE_MAP_PROVIDER}
      />,
    );
  });
  const adjust = async actionName =>
    act(async () =>
      renderer.root
        .findAllByProps({ testID: 'tracking-sheet-handle' })[0]
        .props.onAccessibilityAction({ nativeEvent: { actionName } }),
    );
  expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'fullscreen-map-screen' }).props
        .style,
    ),
  ).toMatchObject({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('更多資料');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('找到狗');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('這支手機');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('手機位置');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('藍點');
  expect(
    renderer.root.findAllByProps({ testID: 'tracking-sheet-summary' })[0].props
      .children,
  ).toBe('最新詳細資訊');
  expect(
    renderer.root.findAllByProps({ testID: 'tracking-sheet-handle' })[0].props
      .accessibilityValue.now,
  ).toBe(0);
  expect(
    renderer.root.findAllByProps({ testID: 'tracking-sheet-content' })[0].props
      .accessibilityElementsHidden,
  ).toBe(true);
  expect(renderer.root.findAllByType(MapView)).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain('讀取失敗：locked');
  await readyMap();
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(true);
  await adjust('increment');
  expect(
    renderer.root.findAllByProps({ testID: 'tracking-sheet' }).length,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Master ID: ');
  expect(JSON.stringify(renderer.toJSON())).toContain('狗速度 ');
  expect(JSON.stringify(renderer.toJSON())).toContain('領犬員裝置電量');
  expect(JSON.stringify(renderer.toJSON())).toContain('LoRa 訊號品質');
  expect(JSON.stringify(renderer.toJSON())).toContain('硬體回報的定位與活動');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('定位與接收資料');
  await act(async () =>
    renderer.root
      .findAllByType(Marker)
      .find(node => node.props.identifier === 'real-master')
      .props.onPress(),
  );
  expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
  const detailsLayer = StyleSheet.flatten(
    renderer.root.findByProps({ testID: 'master-details' }).props.style,
  );
  const sheetLayer = StyleSheet.flatten(
    renderer.root.findAllByProps({ testID: 'tracking-sheet' })[0].props.style,
  );
  // JS hit testing and Android native control dispatch must agree. An inner
  // panel shadow alone does not raise the details root above its sibling sheet.
  expect(detailsLayer.zIndex).toBeGreaterThan(sheetLayer.zIndex);
  expect(detailsLayer.elevation).toBeGreaterThan(sheetLayer.elevation);
  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'master-details-backdrop' }).props
        .style,
    ),
  ).toMatchObject({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('顯示領犬員路徑');
});

test('tile completion and changed padding never refit an already framed map', async () => {
  await render();
  await readyMap();
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(0);
  await act(async () =>
    renderer.update(
      <TrackingMap {...defaults} topInset={40} bottomInset={100} />,
    ),
  );
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(0);
  expect(defaults.onStatus.mock.calls.every(([value]) => value === null)).toBe(
    true,
  );
});

test('waits for initial DB positions; a later Demo reset does not remount native map with stale readiness', async () => {
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
          master: null,
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
  expect(JSON.stringify(renderer.toJSON())).toContain('正在載入本機路徑');
});

test('phone blue dot requires permission, ready map and foreground; never adds phone to DB markers or framing', async () => {
  await render({ phoneEnabled: true });
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(false);
  await readyMap();
  expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(true);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
  expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
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
