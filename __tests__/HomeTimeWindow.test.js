import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Platform } from 'react-native';
import NativePlatform from '../specs/NativeTrackingPlatform';
import MapScreen from '../src/screens/MapScreen';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { createTrackingMapPresentation } from '../src/map/TrackingMapPresentation';
import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import { mergeDogMarkers, MAX_AGE_MS } from '../src/map/DogMerge';
import {
  DEFAULT_TRACKING_PREFERENCES,
  WINDOW_PRESETS,
} from '../src/tracking/TrackingPreferences';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const MINUTE = 60000;
// Zig-zag coordinates: a straight line would be simplified down to its two
// endpoints, which says nothing about clipping.
const row = (id, minutesAgo, extra = {}) => ({
  id,
  receivedAt: NOW - minutesAgo * MINUTE,
  masterId: 3,
  slaveId: 7,
  masterLat: 25,
  masterLon: 121,
  slaveLat: 25.001 + (id % 2 ? id : -id) / 10000,
  slaveLon: 121.001 + id / 10000,
  ...extra,
});
const routeOf = rows => {
  const route = createLiveRouteWindow();
  route.append(rows);
  return route.snapshot();
};
const preferences = extra => ({ ...DEFAULT_TRACKING_PREFERENCES, showTrails: true, ...extra });

test('the drawn line keeps only the selected window, without rereading SQLite', () => {
  const rows = [row(1, 45), row(2, 25), row(3, 5), row(4, 1)];
  const route = routeOf(rows);
  const points = window => createTrackingMapPresentation(
    rows[3], route, [], preferences({ windowMinutes: window }), NOW,
  ).slaveSegments.flat();

  // A shorter window draws fewer points; the same cached route answers every
  // window, so no new query is involved.
  expect(points(10).length).toBeLessThan(points(30).length);
  expect(points(1440)).toHaveLength(4);
  // Everything inside the window is kept, plus one anchor before it so the
  // line still enters the window.
  const inside = points(10).filter(point => point.time >= NOW - 10 * MINUTE);
  expect(inside).toHaveLength(2);
  expect(points(10)).toHaveLength(3);
  expect(points(10)[0].time).toBe(NOW - 25 * MINUTE);
});

test('a window with no earlier row draws no line instead of a single point', () => {
  const rows = [row(1, 45), row(2, 40)];
  const presentation = createTrackingMapPresentation(
    rows[1], routeOf(rows), [], preferences({ windowMinutes: 10 }), NOW,
  );
  expect(presentation.slaveSegments).toEqual([]);
  expect(presentation.slave).toMatchObject({ stale: true });
});

test('positions older than 24 hours leave the home map entirely', () => {
  const old = row(1, MAX_AGE_MS / MINUTE + 10);
  const presentation = createTrackingMapPresentation(
    old, routeOf([old]), [], preferences(), NOW,
  );
  expect(presentation.slave).toBeNull();
  expect(presentation.master).toBeNull();
  expect(presentation.positions).toEqual({ master: null, slave: null });
});

test('a dog last seen before the window is marked stale, not dropped', () => {
  const dogs = mergeDogMarkers({
    point: row(1, 40), now: NOW, windowMs: 10 * MINUTE,
  });
  expect(dogs).toHaveLength(1);
  expect(dogs[0].stale).toBe(true);
  expect(mergeDogMarkers({ point: row(1, 2), now: NOW, windowMs: 10 * MINUTE })[0].stale)
    .toBe(false);
});

test('the largest preset is exactly the 24-hour limit of the home map', () => {
  // Two constants describe the same rule: the longest window a user can pick
  // and the age at which a position leaves the home map. They must not drift.
  expect(Math.max(...WINDOW_PRESETS) * MINUTE).toBe(MAX_AGE_MS);
});

test('the sheet offers the confirmed presets and saves the one that is tapped', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const saveTrackingPreferences = jest.fn();
  const rows = [row(1, 20), row(2, 2)];
  const tracking = {
    mode: 'real',
    point: rows[1],
    route: routeOf(rows),
    positionSamples: [],
    ready: { real: true },
    errors: {},
    initialSnapshotReady: true,
    foreground: true,
    preferences: { ready: true, busy: false, value: preferences({ windowMinutes: 10 }) },
    saveTrackingPreferences,
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  // The sheet starts collapsed; its controls exist once it is expanded.
  await act(async () => renderer.root
    .findAllByProps({ testID: 'tracking-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  // deep: false keeps the Pressable itself, not the View it renders with the
  // same accessibility props.
  const chips = renderer.root.findAll(
    node => node.props.accessibilityLabel?.startsWith('時間範圍 '),
    { deep: false },
  );
  expect(chips.map(node => node.props.accessibilityLabel)).toEqual([
    '時間範圍 1 分', '時間範圍 10 分', '時間範圍 30 分',
    '時間範圍 1 小時', '時間範圍 6 小時', '時間範圍 24 小時',
  ]);
  expect(chips).toHaveLength(WINDOW_PRESETS.length);
  expect(chips[1].props.accessibilityState.selected).toBe(true);
  await act(async () => chips[2].props.onPress());
  expect(saveTrackingPreferences).toHaveBeenCalledWith({ windowMinutes: 30 });
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the map draws the window line and fades a dog seen before it', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const rows = [row(1, 40), row(2, 35)];
  const tracking = {
    mode: 'real',
    point: rows[1],
    route: routeOf(rows),
    positionSamples: [],
    ready: { real: true },
    errors: {},
    initialSnapshotReady: true,
    foreground: true,
    preferences: { ready: true, busy: false, value: preferences({ windowMinutes: 10 }) },
    saveTrackingPreferences: jest.fn(),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  const dog = renderer.root.findAllByType(Marker).find(node => node.props.title === '狗 7');
  expect(dog.props.description).toContain('早於所選時間範圍');
  // Nothing inside the window, so no line is drawn for it.
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});
