import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Platform, Switch } from 'react-native';
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
  // Everything inside the window is kept, plus the point where the line crosses
  // into it: simplification leaves no vertex on the boundary, and the previous
  // vertex can be far older than the window.
  const inside = points(10).filter(point => point.time > NOW - 10 * MINUTE);
  expect(inside).toHaveLength(2);
  expect(points(10)).toHaveLength(3);
  expect(points(10)[0].time).toBe(NOW - 10 * MINUTE);
  // The crossing sits on the line between the two rows it was computed from.
  const [before, after] = [rows[1], rows[2]];
  const ratio = (NOW - 10 * MINUTE - before.receivedAt)
    / (after.receivedAt - before.receivedAt);
  expect(points(10)[0].latitude).toBeCloseTo(
    before.slaveLat + (after.slaveLat - before.slaveLat) * ratio, 9);
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
    node => node.props.accessibilityLabel?.startsWith('過去 '),
    { deep: false },
  );
  expect(chips.map(node => node.props.accessibilityLabel)).toEqual([
    '過去 1 分', '過去 10 分', '過去 30 分',
    '過去 1 小時', '過去 6 小時', '過去 24 小時',
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
  const dog = renderer.root.findAllByType(Marker)
    .find(node => node.props.identifier === 'real-dog-7');
  // The marker has no bubble of its own; the reason is on the view for screen
  // readers and in the card's row.
  expect(dog.props.children.props.accessibilityLabel).toContain('早於所選時間範圍');
  // Nothing inside the window, so no line is drawn for it.
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the home map keeps ageing while the collar is silent', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  // Nothing about these props changes again: no new rows, no new cloud rows,
  // no preference change. Only the clock moves.
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
    saveTrackingPreferences: jest.fn(),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  const label = node => node.props.children.props.accessibilityLabel;
  const dog = () => renderer.root.findAllByType(Marker)
    .find(node => node.props.identifier === 'real-dog-7');
  expect(label(dog())).not.toContain('早於所選時間範圍');
  // Ten minutes later the same row is outside the window.
  await act(async () => jest.advanceTimersByTime(10 * MINUTE));
  expect(label(dog())).toContain('早於所選時間範圍');
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  // A day later it leaves the home map altogether.
  await act(async () => jest.advanceTimersByTime(MAX_AGE_MS));
  expect(dog()).toBeUndefined();
  expect(renderer.root.findAllByType(Marker)
    .some(node => node.props.identifier === 'real-slave')).toBe(false);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the path switch and the window live in one section and the switch saves', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const saveTrackingPreferences = jest.fn();
  const rows = [row(1, 20), row(2, 2)];
  const tracking = {
    mode: 'real', point: rows[1], route: routeOf(rows), positionSamples: [],
    ready: { real: true }, errors: {}, initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, busy: false, value: preferences({ showTrails: false }) },
    saveTrackingPreferences,
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root
    .findAllByProps({ testID: 'tracking-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  // A real switch, not a row of text that has to be read to know its state.
  const toggle = renderer.root.findAllByType(Switch)[0];
  expect(toggle.props.accessibilityLabel).toBe('顯示移動路徑');
  expect(toggle.props.value).toBe(false);
  await act(async () => toggle.props.onValueChange(true));
  expect(saveTrackingPreferences).toHaveBeenCalledWith({ showTrails: true });
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the first fit frames the pair and its path, not distant cloud dogs', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const rows = [row(1, 20), row(2, 2)];
  const tracking = {
    mode: 'real', point: rows[1], route: routeOf(rows), positionSamples: [],
    ready: { real: true }, errors: {}, initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, busy: false, value: preferences({ windowMinutes: 1440 }) },
    saveTrackingPreferences: jest.fn(),
  };
  // A dog 40 km away, downloaded from another Master's upload.
  const cloudRows = [{ slave_id: 9, master_id: 5, received_at: NOW - MINUTE,
    slave_lat: 25.4, slave_lon: 121.4 }];
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      cloudDogs={{ rows: cloudRows, error: '' }} bottomInset={80}
      mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  const { cameraPositions } = renderer.root.findAll(
    node => !!node.props.presentation, { deep: false })[0].props.presentation;
  // Framing every cloud dog zoomed out to the whole county, where the path the
  // handler is working with is a dot.
  expect(cameraPositions.every(point => point.latitude < 25.1)).toBe(true);
  expect(cameraPositions.length).toBeGreaterThan(1);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('saving a preference does not dim the card', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const rows = [row(1, 20), row(2, 2)];
  const tracking = {
    mode: 'real', point: rows[1], route: routeOf(rows), positionSamples: [],
    ready: { real: true }, errors: {}, initialSnapshotReady: true, foreground: true,
    // A write is in flight: the card used to grey out until it finished, so
    // every eye tap flashed.
    preferences: { ready: true, busy: true, value: preferences() },
    saveTrackingPreferences: jest.fn(),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} phone={{ enabled: true }}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root
    .findAllByProps({ testID: 'tracking-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  const eye = renderer.root.findAll(
    node => node.props.accessibilityLabel?.endsWith('位置') &&
      typeof node.props.onPress === 'function', { deep: false })[0];
  expect(eye.props.accessibilityState.disabled).toBe(false);
  expect(JSON.stringify(eye.props.style)).not.toContain('0.45');
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the window presets fold away while the path is switched off', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const rows = [row(1, 20), row(2, 2)];
  const base = {
    mode: 'real', point: rows[1], route: routeOf(rows), positionSamples: [],
    ready: { real: true }, errors: {}, initialSnapshotReady: true, foreground: true,
    saveTrackingPreferences: jest.fn(),
  };
  const view = showTrails => (
    <MapScreen phone={{ enabled: true }} bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER}
      tracking={{ ...base,
        preferences: { ready: true, busy: false, value: preferences({ showTrails }) } }} />
  );
  let renderer;
  await act(async () => { renderer = Renderer.create(view(false)); });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root
    .findAllByProps({ testID: 'tracking-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  const presets = () => renderer.root.findAll(
    node => node.props.accessibilityLabel?.startsWith('過去 '), { deep: false });
  // Nothing to choose while no path is drawn.
  expect(presets()).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('開啟後可以選擇');
  await act(async () => renderer.update(view(true)));
  expect(presets()).toHaveLength(WINDOW_PRESETS.length);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});
