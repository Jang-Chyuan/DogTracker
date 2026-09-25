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
import { useMapClock } from '../src/map/useMapClock';
import {
  DEFAULT_TRACKING_PREFERENCES,
  WINDOW_PRESETS,
} from '../src/tracking/TrackingPreferences';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const MINUTE = 60000;

test('the first foreground render expires cached positions before effects run', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  const renders = [];
  function ClockProbe({ running }) {
    const now = useMapClock(running);
    renders.push(mergeDogMarkers({ now, windowMs: 120000,
      cloudRows: [{ slave_id: 4, master_id: 5, received_at: NOW, slave_lat: 25, slave_lon: 121 }] })[0].stale);
    return null;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<ClockProbe running />); });
    expect(renders.at(-1)).toBe(false);
    await act(async () => { renderer.update(<ClockProbe running={false} />); });
    jest.setSystemTime(NOW + 120001);
    renders.length = 0;
    await act(async () => { renderer.update(<ClockProbe running />); });
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every(stale => stale)).toBe(true);
  } finally {
    await act(async () => { renderer?.unmount(); });
    jest.useRealTimers();
  }
});
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
  expect(presentation.slave).toBeNull();
  expect(presentation.positions.slave).toMatchObject({ stale: true });
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

test('the live sheet hides route time presets', async () => {
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
  expect(chips).toHaveLength(0);
  expect(saveTrackingPreferences).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the map hides a dog seen before the selected window', async () => {
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
  // An expired position stays in the details list, not on the map.
  expect(dog).toBeUndefined();
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
  const rows = [row(1, 20), row(2, 0)];
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
  const label = node => node.findAll(child => typeof child.props.accessibilityLabel === 'string')[0].props.accessibilityLabel;
  const dog = () => renderer.root.findAllByType(Marker)
    .find(node => node.props.identifier === 'real-dog-7');
  expect(label(dog())).not.toContain('早於所選時間範圍');
  // Even a saved ten-minute setting cannot override the fixed two-minute limit.
  await act(async () => jest.advanceTimersByTime(2 * MINUTE));
  expect(dog()).toBeDefined();
  await act(async () => jest.advanceTimersByTime(10000));
  expect(dog()).toBeUndefined();
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

test('the live sheet does not offer a path switch', async () => {
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
  expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
  expect(saveTrackingPreferences).not.toHaveBeenCalled();
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
  const rows = [row(1, 20), row(2, 0.5)];
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

test('legacy path preferences cannot reveal live route controls', async () => {
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
  // Neither route nor live expiry controls are offered.
  expect(presets()).toHaveLength(0);
  expect(renderer.root.findAll(node =>
    node.props.accessibilityLabel?.startsWith('即時位置過去 '))).toHaveLength(0);
  await act(async () => renderer.update(view(true)));
  expect(presets()).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  jest.useRealTimers();
});
