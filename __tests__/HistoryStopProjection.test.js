import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import MapView, { mockCamera } from 'react-native-maps';
import MapScreen from '../src/screens/MapScreen';
import TrackingMap from '../src/map/TrackingMap';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { historyTargetOf } from '../src/mapHistory/useHistoryScreen';
import * as models from '../src/history/screen/HistoryMultiModel';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';

const mockLive = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { live: (...args) => mockLive(...args) },
}));

test('a cursor move preserves stop projections; camera changes project them again', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXTURE_NOW);
  mockCamera.pointForCoordinate = jest.fn(async () => ({x:200,y:400}));
  const os = Platform.OS;
  Platform.OS = 'android';
  const fixture = buildFixture('history-my-route');
  const payload = JSON.stringify({ running: false, status: 'stopped', enabled: false,
    stoppedAt: FIXTURE_NOW, extra: { battery: 50 } });
  mockLive.mockResolvedValue(payload);
  const model = jest.spyOn(models, 'multiDayModel');
  let tree;
  try {
    await act(async () => {
      tree = Renderer.create(
        <>
          <MapScreen tracking={{ ...fixture.tracking, foreground: true, ready: { real: true },
            errors: {}, preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES },
            initialSnapshotReady: true }} phone={{ enabled: false }} historical
            historyTarget={historyTargetOf(fixture.history.preferences)} history={fixture.history}
            bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />
        </>,
      );
    });
    await act(async () => tree.root.findByType(MapView).props.onMapReady());
    await act(async () => tree.root.findByType(MapView).props.onMapLoaded());
    // Let cold-start framing / phone wait timers settle before counting idle work.
    await act(async () => jest.advanceTimersByTimeAsync(10000));
    const geometry = tree.root.findByType(TrackingMap).props.presentation.historyRoute;
    expect(geometry.points.length).toBeGreaterThan(0);
    const beforeModels = model.mock.calls.length, beforeProjection = mockCamera.pointForCoordinate.mock.calls.length;
    const mapProps = tree.root.findByType(TrackingMap).props;
    const spot = geometry.points[Math.floor(geometry.points.length / 3)];
    await act(async () => mapProps.onCursorMove(spot.time, 'route'));
    const afterRoute = tree.root.findByType(TrackingMap).props.presentation.historyRoute;
    expect(afterRoute.places).toBe(geometry.places);
    expect(afterRoute.points).toBe(geometry.points);
    // Native calls are for the moving cursor/focus, not all four stays.
    expect(geometry.places).toHaveLength(4);
    expect(mockCamera.pointForCoordinate.mock.calls.length - beforeProjection).toBe(2);
    expect(model.mock.calls.length - beforeModels).toBe(0);
    const nearby = geometry.points[Math.floor(geometry.points.length / 3) + 1];
    await act(async () => tree.root.findByType(TrackingMap).props.onCursorMove(nearby.time, 'route'));
    const nearbyRoute = tree.root.findByType(TrackingMap).props.presentation.historyRoute;
    expect(nearbyRoute.places).toBe(geometry.places);
    const beforeCamera = mockCamera.pointForCoordinate.mock.calls.length;
    await act(async () => tree.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
    expect(mockCamera.pointForCoordinate.mock.calls.length - beforeCamera).toBeGreaterThanOrEqual(geometry.places.length);
  } finally {
    await act(async () => tree?.unmount());
    model.mockRestore();
    delete mockCamera.pointForCoordinate;
    Platform.OS = os;
    jest.useRealTimers();
  }
});
