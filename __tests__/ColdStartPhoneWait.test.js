// The cold start with no local dog frames only the phone: its last known
// position (10 minutes, precise) frames it at once; with none the map waits
// PHONE_ALONE_WAIT_MS (2 s) for a first fix, then opens without it.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import MapScreen, { PHONE_ALONE_WAIT_MS } from '../src/screens/MapScreen';
import TrackingMap from '../src/map/TrackingMap';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { emptyTrackingPoint } from '../src/models/TrackingPoint';
import { framedCoordinates } from '../src/map/MapFraming';

const mockLive = jest.fn();
const mockLastKnown = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: {
    live: (...args) => mockLive(...args),
    lastKnown: (...args) => mockLastKnown(...args),
    displayPosition: jest.fn(),
    clearDisplayPosition: jest.fn(),
  },
}));

const NOW = Date.UTC(2026, 9, 13, 2, 0, 0);
const tracking = { mode: 'real', point: emptyTrackingPoint, route: emptyLiveRoute(), ready: { real: true },
  errors: { real: null }, initialSnapshotReady: true, historyLoaded: true, foreground: true,
  preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES } };
let tree;
const os = Platform.OS;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  Platform.OS = 'android';
  mockLive.mockReset();
  mockLastKnown.mockReset();
  // Recording, still waiting for its first fresh fix.
  mockLive.mockImplementation(async () => JSON.stringify({ running: true, status: 'waiting', ageSeconds: null }));
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = null;
  Platform.OS = os;
  jest.useRealTimers();
});
const start = async (phone = { enabled: true }) => {
  await act(async () => {
    tree = Renderer.create(<MapScreen tracking={tracking} receiver={{ state: null }} phone={phone}
      bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => jest.advanceTimersByTimeAsync(10));
};
const map = () => tree.root.findByType(TrackingMap).props;

test('no fix and no last known position: waits 2 s, not 6, then frames nothing', async () => {
  expect(PHONE_ALONE_WAIT_MS).toBe(2000);
  mockLastKnown.mockResolvedValue(null);
  await start();
  expect(mockLastKnown).toHaveBeenCalledTimes(1);
  expect(map().framingReady).toBe(false);
  await act(async () => jest.advanceTimersByTimeAsync(PHONE_ALONE_WAIT_MS - 100));
  expect(map().framingReady).toBe(false);
  await act(async () => jest.advanceTimersByTimeAsync(100));
  expect(map().framingReady).toBe(true);
  expect(map().presentation.cameraPositions).toEqual([]);
});

test('a precise last known position from the last 10 minutes frames the phone at once', async () => {
  mockLastKnown.mockResolvedValue(JSON.stringify({ latitude: 24.99, longitude: 121.31, accuracy: 8, ageSeconds: 45 }));
  await start();
  expect(map().framingReady).toBe(true);
  // One point: the small square around the phone (framedCoordinates).
  expect(map().presentation.cameraPositions).toEqual(framedCoordinates([{ latitude: 24.99, longitude: 121.31 }]));
});

test('an old or coarse last known position does not count; nor is it read without location', async () => {
  mockLastKnown.mockResolvedValue(JSON.stringify({ latitude: 24.99, longitude: 121.31, accuracy: 800, ageSeconds: 45 }));
  await start();
  expect(map().framingReady).toBe(false);
  expect(map().presentation.cameraPositions).toEqual([]);
  await act(async () => tree.unmount());
  mockLastKnown.mockClear();
  await start({ enabled: false });
  expect(mockLastKnown).not.toHaveBeenCalled();
});

test('a recorder not started yet (位置記錄 on) still waits; 位置記錄 off or no location does not', async () => {
  mockLastKnown.mockResolvedValue(null);
  mockLive.mockImplementation(async () => JSON.stringify({ running: false, enabled: true, status: 'idle' }));
  await start();
  expect(map().framingReady).toBe(false);
  await act(async () => jest.advanceTimersByTimeAsync(PHONE_ALONE_WAIT_MS));
  expect(map().framingReady).toBe(true);
  await act(async () => tree.unmount());
  mockLive.mockImplementation(async () => JSON.stringify({ running: false, enabled: false, status: 'off' }));
  await start();
  expect(map().framingReady).toBe(true);
  await act(async () => tree.unmount());
  mockLive.mockImplementation(async () => JSON.stringify({ running: false, enabled: true, status: 'idle' }));
  await start({ enabled: false });
  expect(map().framingReady).toBe(true);
});
