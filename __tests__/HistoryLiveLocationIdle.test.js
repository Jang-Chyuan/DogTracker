import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import MapView from 'react-native-maps';
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

test('unchanged stopped live snapshots retain the historical map and day model', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXTURE_NOW);
  const os = Platform.OS;
  Platform.OS = 'android';
  const fixture = buildFixture('history-my-route');
  const payload = JSON.stringify({ running: false, status: 'stopped', enabled: false,
    stoppedAt: FIXTURE_NOW, extra: { battery: 50 } });
  mockLive.mockResolvedValue(payload);
  const model = jest.spyOn(models, 'multiDayModel');
  let commits = 0, tree;
  try {
    await act(async () => {
      tree = Renderer.create(
        <React.Profiler id="map" onRender={() => { commits += 1; }}>
          <MapScreen tracking={{ ...fixture.tracking, foreground: true, ready: { real: true },
            errors: {}, preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES },
            initialSnapshotReady: true }} phone={{ enabled: false }} historical
            historyTarget={historyTargetOf(fixture.history.preferences)} history={fixture.history}
            bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />
        </React.Profiler>,
      );
    });
    await act(async () => tree.root.findByType(MapView).props.onMapReady());
    await act(async () => tree.root.findByType(MapView).props.onMapLoaded());
    // Let cold-start framing / phone wait timers settle before counting idle work.
    await act(async () => jest.advanceTimersByTimeAsync(10000));
    const before = commits, calls = model.mock.calls.length, reads = mockLive.mock.calls.length;
    const geometry = tree.root.findByType(TrackingMap).props.presentation.historyRoute;
    expect(geometry.points.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i += 1)
      await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(model.mock.calls.length - calls).toBe(0);
    expect(tree.root.findByType(TrackingMap).props.presentation.historyRoute).toBe(geometry);
    expect(mockLive.mock.calls.length - reads).toBe(5);
    expect(commits - before).toBe(0);
  } finally {
    await act(async () => tree?.unmount());
    model.mockRestore();
    Platform.OS = os;
    jest.useRealTimers();
  }
});
