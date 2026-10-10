import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import MapView, { Marker, Polyline, mockCamera } from 'react-native-maps';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import MapScreen from '../src/screens/MapScreen';
import TrackingMap from '../src/map/TrackingMap';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { historyTargetOf } from '../src/mapHistory/useHistoryScreen';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';

const mockLive = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { live: (...args) => mockLive(...args) },
}));

test('fresh recording snapshots still publish without rebuilding the unchanged historical marker subtree', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXTURE_NOW);
  const os = Platform.OS;
  Platform.OS = 'android';
  const fixture = buildFixture('history-my-route');
  let snapshot = { running: true, enabled: true, ageSeconds: 0,
    position: { latitude: 25, longitude: 121, timestamp: FIXTURE_NOW, accuracy: 10 },
    sessionId: 'unit-session', saved: 12, futureNativeField: { battery: 50 } };
  mockLive.mockImplementation(async () => JSON.stringify(snapshot));
  let tree, iterate;
  try {
    await act(async () => {
      tree = Renderer.create(
        <MapScreen tracking={{ ...fixture.tracking, foreground: true, ready: { real: true },
          errors: {}, preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES },
          initialSnapshotReady: true }} phone={{ enabled: true }} historical
          historyTarget={historyTargetOf(fixture.history.preferences)} history={fixture.history}
          bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />,
      );
    });
    await act(async () => tree.root.findByType(MapView).props.onMapReady());
    await act(async () => tree.root.findByType(MapView).props.onMapLoaded());
    await act(async () => jest.advanceTimersByTimeAsync(10000));
    const map = () => tree.root.findByType(TrackingMap).props;
    const geometry = map().presentation.historyRoute;
    expect(geometry.places.length).toBeGreaterThan(0);
    const stopPress = map().onStopPress;
    iterate = jest.spyOn(geometry.places, 'map');
    const reads = mockLive.mock.calls.length;
    for (let age = 1; age <= 5; age += 1) {
      snapshot = { ...snapshot, ageSeconds: age, saved: 12 + age,
        futureNativeField: { battery: 50 - age } };
      await act(async () => jest.advanceTimersByTimeAsync(1000));
      expect(map().livePhone).toEqual(snapshot);
      expect(map().presentation.historyRoute).toBe(geometry);
    }
    expect(mockLive.mock.calls.length - reads).toBe(5);
    expect(iterate).not.toHaveBeenCalled();
    expect(map().onStopPress).toBe(stopPress);
    const place = geometry.places[1];
    await act(async () => map().onStopPress(place));
    expect(map().presentation.historyRoute).not.toBe(geometry);
    expect(map().presentation.historyRoute.cursor.time).toBe(place.start);
    expect(map().onStopPress).not.toBe(stopPress);
    // Keep the handler's new cursor/model closure on a second real stop tap.
    const nextPlace = map().presentation.historyRoute.places[2];
    await act(async () => map().onStopPress(nextPlace));
    expect(map().presentation.historyRoute.cursor.time).toBe(nextPlace.start);
    const history = () => tree.root.findByType(HistoryScreen).props.screen;
    const originalDay = history().day;
    await act(async () => history().changeDay(originalDay - 86400000));
    expect(history().day).toBe(originalDay - 86400000);
    expect(map().presentation.historyRoute?.places ?? []).toHaveLength(0);
    await act(async () => history().changeDay(originalDay));
    expect(map().presentation.historyRoute.places.length).toBeGreaterThan(0);
    const restoredPlace = map().presentation.historyRoute.places[1];
    await act(async () => map().onStopPress(restoredPlace));
    expect(map().presentation.historyRoute.cursor.time).toBe(restoredPlace.start);
  } finally {
    iterate?.mockRestore();
    await act(async () => tree?.unmount());
    Platform.OS = os;
    jest.useRealTimers();
  }
});


test('memoized route still updates changed geometry, stop callbacks, camera zoom and theme context', async () => {
  jest.useFakeTimers();
  const os = Platform.OS;
  Platform.OS = 'android';
  const coordinate = { latitude: 25, longitude: 121 };
  const place = { key: 'unit-stop', kind: 'stop', number: 1, start: 1000, coordinate };
  let route = { color: '#1373E8', points: [], camera: [], cursor: null,
    places: [place], times: [], lines: [{ id: 'unit-line', start: 1000, color: '#1373E8', width: 4,
      dashed: false, coordinates: [coordinate, { latitude: 25.001, longitude: 121.001 }] }] };
  let onStopPress = jest.fn();
  let theme = lightTheme;
  const element = () => <ThemeScope theme={theme}><TrackingMap provider={GOOGLE_MAP_PROVIDER}
    source="history-unit" topInset={100} bottomInset={300} foreground
    dataReady framingReady onStopPress={onStopPress}
    presentation={{ historyMode: true, historyRoute: route, positions: {}, dogMarkers: [],
      cameraPositions: [], slaveSegments: [], rangeRing: null, rangeLines: [] }} /></ThemeScope>;
  let tree, iterate;
  const camera = mockCamera.getCamera.getMockImplementation();
  try {
    await act(async () => { tree = Renderer.create(element()); });
    await act(async () => tree.root.findByType(MapView).props.onMapReady());
    await act(async () => tree.root.findByType(MapView).props.onMapLoaded());
    const stop = () => tree.root.findAllByType(Marker).find(marker => marker.props.onPress);
    expect(stop()).toBeDefined();
    await act(async () => stop().props.onPress());
    expect(onStopPress).toHaveBeenCalledWith(place);
    const originalHandler = onStopPress;
    onStopPress = jest.fn();
    await act(async () => tree.update(element()));
    await act(async () => stop().props.onPress());
    expect(onStopPress).toHaveBeenCalledWith(place);
    expect(originalHandler).toHaveBeenCalledTimes(1);
    const nextPlace = { ...place, coordinate: { latitude: 25.002, longitude: 121.002 }, number: 2 };
    route = { ...route, places: [nextPlace], lines: [{ ...route.lines[0], id: 'changed-line', width: 6 }] };
    await act(async () => tree.update(element()));
    expect(stop().props.coordinate).toEqual(nextPlace.coordinate);
    expect(tree.root.findAllByType(Polyline)[0].props.strokeWidth).toBe(6);
    await act(async () => stop().props.onPress());
    expect(onStopPress).toHaveBeenLastCalledWith(nextPlace);
    iterate = jest.spyOn(route.places, 'map');
    mockCamera.getCamera.mockResolvedValue({ center: coordinate, zoom: 15, heading: 0 });
    await act(async () => tree.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
    expect(iterate).toHaveBeenCalled();
    iterate.mockClear();
    // Same route object and handlers: React context must still reach the child.
    theme = darkTheme;
    await act(async () => tree.update(element()));
    expect(iterate).toHaveBeenCalled();
    expect(tree.root.findAllByType(Polyline)).toHaveLength(2);
    expect(tree.root.findAllByType(Polyline)[0].props.strokeColor).toBe(darkTheme.colors.routeCasing);
  } finally {
    iterate?.mockRestore();
    mockCamera.getCamera.mockImplementation(camera);
    await act(async () => tree?.unmount());
    Platform.OS = os;
    jest.useRealTimers();
  }
});
