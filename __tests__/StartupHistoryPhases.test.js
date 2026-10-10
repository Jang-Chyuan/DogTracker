/* global globalThis */
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import MapView, { mockCamera } from 'react-native-maps';
import MapScreen from '../src/screens/MapScreen';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { historyTargetOf } from '../src/mapHistory/useHistoryScreen';
import * as models from '../src/history/screen/HistoryMultiModel';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';

const mockLive = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { live: (...args) => mockLive(...args) },
}));

test('opt-in actual history hook reports read/build/commit and map mounting phases', async () => {
  globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ = true;
  const output = jest.spyOn(console, 'info').mockImplementation(() => {});
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
    const events = output.mock.calls.map(call => JSON.parse(call[1]));
    for (const phase of ['phone-day-read', 'phone-day-publish', 'phone-model', 'phone-model-commit',
      'map-data-ready', 'map-mounted', 'map-loaded']) {
      expect(events.some(event => event.phase === phase && event.event === 'end')).toBe(true);
    }
    expect(events.every(event => Object.keys(event).sort().join(',') === 'atMs,durationMs,event,phase,sequence')).toBe(true);
    await act(async () => jest.advanceTimersByTimeAsync(120000));
    // Repeated current-day polls do not consume the second distinct-day sample.
    const readEnds = () => output.mock.calls.map(call => JSON.parse(call[1]))
      .filter(event => event.phase === 'phone-day-read' && event.event === 'end');
    expect(readEnds()).toHaveLength(1);
    const screen = tree.root.findByType(HistoryScreen).props.screen;
    await act(async () => screen.changeDay(screen.day - 86400000));
    expect(readEnds()).toHaveLength(2);
    expect(readEnds().map(event => event.sequence)).toEqual([1, 2]);

  } finally {
    await act(async () => tree?.unmount());
    model.mockRestore();
    delete mockCamera.pointForCoordinate;
    Platform.OS = os;
    jest.useRealTimers();
    delete globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__;
    output.mockRestore();
  }
});
