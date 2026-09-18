import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MapView, { Polyline } from 'react-native-maps';
import { Platform } from 'react-native';
import NativePlatform from '../specs/NativeTrackingPlatform';
import MapScreen from '../src/screens/MapScreen';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { createLiveRouteWindow } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import {
  clipTrackTo,
  cursorFraction,
  nextCursor,
  playbackWindow,
  speedLabel,
} from '../src/mapHistory/HistoryPlayback';
import { useHistoryPlayback } from '../src/mapHistory/useHistoryPlayback';
import HistoryPlaybackControls from '../src/mapHistory/HistoryPlaybackControls';

const SINCE = Date.parse('2026-09-18T00:00:00Z');
const UNTIL = SINCE + 4 * 3600000;
const point = (minutes, lat) => ({ time: SINCE + minutes * 60000, latitude: lat, longitude: 121 });
const MINUTES = [0, 30, 90, 150, 200];
const track = (minutes = MINUTES) => ({
  name: 'Client',
  segments: [[point(0, 25), point(30, 25.001), point(90, 25.002)], [point(150, 25.01), point(200, 25.02)]],
  latest: point(200, 25.02),
  count: 5,
  limited: false,
  times: minutes.map(value => SINCE + value * 60000),
});
// The query asks for four hours; the rows only cover the first 200 minutes.
const FIRST = SINCE;
const LAST = SINCE + 200 * 60000;
const data = (client = track()) => ({ since: SINCE, until: UNTIL, phone: track(),
  clients: [{ slaveId: 4, ...client }] });

// The repo has no hook testing library: a probe component publishes the hook's
// value, the same pattern as CloudDogs.test.js.
let latest;
function Probe({ value, queryKey }) {
  latest = useHistoryPlayback(value, queryKey);
  return null;
}
async function mountHook(props) {
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe {...props} />); });
  return {
    rerender: async next => act(async () => renderer.update(<Probe {...next} />)),
    unmount: async () => act(async () => renderer.unmount()),
  };
}

test('the window is where the rows are, not what the query asked for', () => {
  // A 24-hour query on a phone that only holds the last three hours would
  // otherwise spend most of the playback on an empty map.
  expect(playbackWindow(data())).toEqual({ since: FIRST, until: LAST });
  expect(playbackWindow(null)).toBeNull();
  expect(playbackWindow({ phone: { times: [] }, clients: [{ times: [] }] })).toBeNull();
  expect(playbackWindow({ phone: { times: [5] }, clients: [{ times: [5] }] })).toBeNull();
});

test('clipping keeps the past of the cursor and moves the marker back with it', () => {
  const clipped = clipTrackTo(track(), SINCE + 60 * 60000);
  expect(clipped.segments).toHaveLength(1);
  expect(clipped.segments[0]).toHaveLength(2);
  expect(clipped.count).toBe(2);
  // The marker is where the device was at that moment, not where it ended up.
  expect(clipped.latest.time).toBe(SINCE + 30 * 60000);
  expect(clipTrackTo(track(), SINCE - 1).segments).toEqual([]);
  expect(clipTrackTo(track(), UNTIL)).toMatchObject({ count: 5 });
});

test('the cursor advances by wall clock times the speed and stops at the end', () => {
  const window = { since: SINCE, until: UNTIL };
  expect(nextCursor(null, window, 600)).toBe(SINCE + 250 * 600);
  expect(nextCursor(UNTIL - 1000, window, 600)).toBe(UNTIL);
  expect(nextCursor(SINCE, null, 600)).toBeNull();
  expect(cursorFraction(SINCE + 2 * 3600000, window)).toBeCloseTo(0.5);
  expect(speedLabel(600)).toBe('10 分／秒');
});

test('playing advances the cursor, pausing holds it and the end stops playback', async () => {
  jest.useFakeTimers();
  const hook = await mountHook({ value: data(), queryKey: 'query' });
  expect(latest.at).toBeNull();
  await act(async () => latest.toggle());
  expect(latest.at).toBe(FIRST);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(latest.at).toBe(FIRST + 1000 * 600);
  await act(async () => latest.toggle());
  const held = latest.at;
  await act(async () => jest.advanceTimersByTime(2000));
  expect(latest.at).toBe(held);
  // Near the end: 500 ms at 600× covers more than the remaining 144 s.
  await act(async () => latest.seek(0.99));
  await act(async () => latest.toggle());
  await act(async () => jest.advanceTimersByTime(500));
  // Reaching the end shows the whole window again instead of parking the cursor
  // on the last moment, which would hide everything recorded since.
  expect(latest.at).toBeNull();
  expect(latest.playing).toBe(false);
  // Playing again starts from the beginning.
  await act(async () => latest.toggle());
  expect(latest.at).toBe(FIRST);
  await act(async () => latest.stop());
  expect(latest.at).toBeNull();
  await hook.unmount();
  jest.useRealTimers();
});

test('a moving window does not disturb playback, but a new query ends it', async () => {
  jest.useFakeTimers();
  const hook = await mountHook({ value: data(), queryKey: 'query' });
  await act(async () => latest.toggle());
  await act(async () => jest.advanceTimersByTime(1000));
  const at = latest.at;
  // "Last N hours" refreshes every few seconds and new rows keep arriving.
  await hook.rerender({
    value: data(track([...MINUTES, 260])), queryKey: 'query',
  });
  expect(latest.at).toBe(at);
  expect(latest.playing).toBe(true);
  expect(latest.window.until).toBe(LAST);
  await hook.rerender({ value: data(), queryKey: 'another-query' });
  expect(latest.at).toBeNull();
  expect(latest.playing).toBe(false);
  await hook.unmount();
  jest.useRealTimers();
});

test('the transport plays, seeks by dragging and says which moment is drawn', async () => {
  const playback = {
    window: { since: FIRST, until: LAST }, at: null, playing: false, speed: 600,
    toggle: jest.fn(), seek: jest.fn(), stop: jest.fn(), setSpeed: jest.fn(),
  };
  let renderer;
  const view = value => <HistoryPlaybackControls playback={value} />;
  await act(async () => { renderer = Renderer.create(view(playback)); });
  const find = label => renderer.root.findAll(
    node => node.props.accessibilityLabel === label, { deep: false })[0];
  await act(async () => find('播放這段區間').props.onPress());
  expect(playback.toggle).toHaveBeenCalled();
  // Nothing to reset while the whole range is drawn.
  expect(find('結束回放，顯示整段')).toBeUndefined();

  const bar = renderer.root.findAllByProps({ testID: 'playback-track' })[0];
  await act(async () => bar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  await act(async () => bar.props.onResponderGrant({ nativeEvent: { locationX: 50 } }));
  expect(playback.seek).toHaveBeenCalledWith(0.25);
  // A vertical drag belongs to the card, not to the scrubber.
  expect(bar.props.onMoveShouldSetResponder(null, { dx: 4, dy: 40 })).toBe(false);
  expect(bar.props.onMoveShouldSetResponder(null, { dx: 40, dy: 4 })).toBe(true);
  await act(async () => find('1 小時／秒').props.onPress());
  expect(playback.setSpeed).toHaveBeenCalledWith(3600);

  // While playing, the moment being drawn is spelled out and can be left.
  await act(async () => renderer.update(view({ ...playback, at: FIRST + 60000, playing: true })));
  expect(find('暫停回放')).toBeDefined();
  expect(find('結束回放，顯示整段')).toBeDefined();
  expect(JSON.stringify(renderer.toJSON())).toContain(
    new Date(FIRST + 60000).toLocaleString('zh-TW', { hour12: false }));
  await act(async () => renderer.unmount());
});

test('a range with no rows says so instead of offering a dead scrubber', async () => {
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<HistoryPlaybackControls playback={{
      window: null, at: null, playing: false, speed: 600,
      toggle: jest.fn(), seek: jest.fn(), stop: jest.fn(), setSpeed: jest.fn(),
    }} />);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('這段區間沒有可以回放的定位');
  expect(renderer.root.findAllByProps({ testID: 'playback-track' })).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('the history map draws only up to the cursor while the card plays', async () => {
  jest.useFakeTimers();
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const history = {
    preferences: { ...HISTORY_DEFAULTS }, data: data(), error: '', busy: false,
    key: 'query', save: jest.fn(),
  };
  const tracking = {
    mode: 'real', point: { id: null, receivedAt: null }, route: createLiveRouteWindow().snapshot(),
    positionSamples: [], ready: { real: true }, errors: {}, initialSnapshotReady: true,
    historyLoaded: true, foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
    saveTrackingPreferences: jest.fn(),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={tracking} history={history} historical
      phone={{ enabled: true }} bottomInset={80} mapProvider={GOOGLE_MAP_PROVIDER} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  const drawn = () => renderer.root.findAllByType(Polyline)
    .reduce((total, node) => total + node.props.coordinates.length, 0);
  const full = drawn();
  expect(full).toBeGreaterThan(0);

  await act(async () => renderer.root
    .findAllByProps({ testID: 'history-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  const bar = renderer.root.findAllByProps({ testID: 'playback-track' })[0];
  await act(async () => bar.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
  // A cursor a quarter of the way in must not show the rest of the outing.
  await act(async () => bar.props.onResponderGrant({ nativeEvent: { locationX: 25 } }));
  expect(drawn()).toBeLessThan(full);
  expect(JSON.stringify(renderer.toJSON())).toContain('回放中：');
  // Ending playback puts the whole window back.
  const stop = renderer.root.findAll(
    node => node.props.accessibilityLabel === '結束回放，顯示整段', { deep: false })[0];
  await act(async () => stop.props.onPress());
  expect(drawn()).toBe(full);
  await act(async () => renderer.unmount());
  Platform.OS = originalOS;
  jest.useRealTimers();
});

test('the scrubber owns the whole drag, so the cursor cannot jump back', async () => {
  const playback = {
    window: { since: FIRST, until: LAST }, at: FIRST, playing: false, speed: 600,
    toggle: jest.fn(), seek: jest.fn(), stop: jest.fn(), setSpeed: jest.fn(),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<HistoryPlaybackControls playback={playback} />);
  });
  const bar = renderer.root.findAllByProps({ testID: 'playback-track' })[0];
  // The rail, the fill and the knob must never receive the touch: a move over
  // the knob would measure locationX from the knob's own left edge, sending the
  // cursor back to the start of the bar and then forward again.
  const children = bar.findAllByType('View').filter(node => node.props.pointerEvents);
  expect(children.length).toBeGreaterThanOrEqual(3);
  expect(children.every(node => node.props.pointerEvents === 'none')).toBe(true);
  await act(async () => renderer.unmount());
});
