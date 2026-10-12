// Idle on the live map with 位置記錄 on: the recording's snapshot changes
// every second (fix age, fix time, counters) even when the phone stands
// still. Only the phone's dot follows each copy; MapScreen and the map around
// it stay as they are, so Google does not redraw the map once a second.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import MapView from 'react-native-maps';
import MapScreen from '../src/screens/MapScreen';
import TrackingMap from '../src/map/TrackingMap';
import PhoneLocationOverlay from '../src/map/PhoneLocationOverlay';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { LIVE_PHONE_REFRESH_MS, livePhoneChanged } from '../src/map/LivePhoneFeed';

const mockLive = jest.fn();
const mockDisplay = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: {
    live: (...args) => mockLive(...args),
    displayPosition: (...args) => mockDisplay(...args),
    clearDisplayPosition: jest.fn(),
  },
}));

const position = (timestamp, extra = {}) => ({
  latitude: 24.9892, longitude: 121.3138, timestamp, accuracy: 5, speedKmh: 0,
  rawSpeedKmh: 0, speedAccuracyMps: 0.5, motionState: 'stationary', bearing: null, ...extra,
});
const snapshot = (second, extra = {}) => ({
  running: true, status: 'recording', received: second, accepted: second, rejected: 0,
  saved: Math.floor(second / 5), writeErrors: 0, ageSeconds: 0.4 + (second % 3) / 10,
  intervalSeconds: 5, sessionId: 'session-a', enabled: true, stoppedAt: null,
  position: position(FIXTURE_NOW + second * 1000), ...extra,
});

describe('livePhoneChanged', () => {
  const shown = snapshot(1);
  test('ignores what moves every second by itself', () => {
    expect(livePhoneChanged(shown, snapshot(2))).toBe(false);
    expect(livePhoneChanged(shown, { ...snapshot(2), ageSeconds: 2.9 })).toBe(false);
  });
  test.each([
    ['the fix getting stale (grey dot)', { ageSeconds: 3.5 }],
    ['the fix getting older than 10 minutes', { ageSeconds: 601 }],
    ['the age going away', { ageSeconds: null }],
    ['a move', { position: position(FIXTURE_NOW + 2000, { latitude: 24.9893 }) }],
    ['a new accuracy', { position: position(FIXTURE_NOW + 2000, { accuracy: 9 }) }],
    ['a new motion state', { position: position(FIXTURE_NOW + 2000, { motionState: 'moving' }) }],
    ['recording stopping', { running: false }],
    ['a new status', { status: 'write failed' }],
    ['a new session', { sessionId: 'session-b' }],
    ['a write error', { writeErrors: 1 }],
    ['an unknown native field', { battery: 10 }],
    ['the position going away', { position: undefined }],
  ])('shows %s at once', (_, change) => {
    expect(livePhoneChanged(shown, { ...snapshot(2), ...change })).toBe(true);
  });
  test('takes a newer fix time every LIVE_PHONE_REFRESH_MS, or an older one at once', () => {
    const later = second => snapshot(1 + second);
    expect(livePhoneChanged(shown, later(LIVE_PHONE_REFRESH_MS / 1000 - 1))).toBe(false);
    expect(livePhoneChanged(shown, later(LIVE_PHONE_REFRESH_MS / 1000))).toBe(true);
    expect(livePhoneChanged(shown, snapshot(0))).toBe(true);
  });
  test('null and the first copy always show', () => {
    expect(livePhoneChanged(null, shown)).toBe(true);
    expect(livePhoneChanged(shown, null)).toBe(true);
    expect(livePhoneChanged(shown, shown)).toBe(false);
  });
});

describe('the live map idle', () => {
  let tree;
  let second;
  let current;
  const os = Platform.OS;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXTURE_NOW);
    Platform.OS = 'android';
    second = 0;
    current = () => snapshot(second);
    mockLive.mockReset();
    mockDisplay.mockReset();
    mockLive.mockImplementation(async () => {
      second += 1;
      return JSON.stringify(current());
    });
  });
  afterEach(async () => {
    await act(async () => tree?.unmount());
    tree = null;
    Platform.OS = os;
    jest.useRealTimers();
  });
  const start = async () => {
    const fixture = buildFixture('history-my-route');
    await act(async () => {
      tree = Renderer.create(
        <MapScreen
          tracking={{ ...fixture.tracking, mode: 'real', foreground: true, ready: { real: true }, errors: {},
            preferences: { ready: true, value: DEFAULT_TRACKING_PREFERENCES }, initialSnapshotReady: true }}
          phone={{ enabled: true }} bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />,
      );
    });
    await act(async () => tree.root.findByType(MapView).props.onMapReady());
    await act(async () => tree.root.findByType(MapView).props.onMapLoaded());
    await act(async () => jest.advanceTimersByTimeAsync(3000));
  };
  const map = () => tree.root.findByType(TrackingMap).props;

  test('a phone standing still re-renders only its dot, which still hands native every fix', async () => {
    await start();
    const shown = map().livePhone;
    expect(shown).toMatchObject({ running: true, sessionId: 'session-a' });
    expect(tree.root.findAllByType(PhoneLocationOverlay)).toHaveLength(1);
    const presentation = map().presentation;
    const dot = () => tree.root.findAll(node => node.props.identifier === 'phone-timeline-live')[0].props;
    const callout = dot().description;
    for (let i = 0; i < 5; i += 1)
      await act(async () => jest.advanceTimersByTimeAsync(1000));
    // The map keeps the copy it drew: no re-render once a second.
    expect(map().livePhone).toBe(shown);
    expect(map().presentation).toBe(presentation);
    // Nor does the dot's marker change its text (Google would redraw).
    expect(dot().description).toBe(callout);
    // The dot drew from the newest copy and told native that fix's time.
    const newest = current().position.timestamp - 1000;
    expect(mockDisplay).toHaveBeenCalledWith('session-a', newest, 24.9892, 121.3138);
  });

  test('a moving phone, a stale fix and a stop still reach the map at once', async () => {
    await start();
    const shown = map().livePhone;
    current = () => snapshot(second, { position: position(FIXTURE_NOW + second * 1000, { latitude: 24.99, motionState: 'moving' }) });
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(map().livePhone).not.toBe(shown);
    expect(map().livePhone.position.latitude).toBe(24.99);
    const moved = map().livePhone;
    current = () => snapshot(second, { ageSeconds: 4, position: moved.position });
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(map().livePhone.ageSeconds).toBe(4);
    current = () => ({ running: false, status: 'stopped', enabled: false, stoppedAt: FIXTURE_NOW });
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(map().livePhone).toMatchObject({ running: false });
    expect(tree.root.findAllByType(PhoneLocationOverlay)).toHaveLength(0);
  });

  test('the map takes a newer fix time every LIVE_PHONE_REFRESH_MS while standing still', async () => {
    await start();
    const shown = map().livePhone;
    await act(async () => jest.advanceTimersByTimeAsync(LIVE_PHONE_REFRESH_MS + 1000));
    expect(map().livePhone).not.toBe(shown);
    expect(map().livePhone.position.timestamp - shown.position.timestamp)
      .toBeGreaterThanOrEqual(LIVE_PHONE_REFRESH_MS);
  });
});
