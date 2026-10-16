import { t as i18nT } from '../src/i18n';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { Circle, Marker } from 'react-native-maps';
import PhoneLocationOverlay from '../src/map/PhoneLocationOverlay';
import { lightTheme, darkTheme, ThemeScope } from '../src/theme/ThemeProvider';
import { locationTrackerNative } from '../src/locationTracker/LocationTrackerService';

jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: {
    displayPosition: jest.fn(),
    clearDisplayPosition: jest.fn(),
  },
}));

let renderer;
const dotStyle = () => StyleSheet.flatten(renderer.root.find(node => typeof node.type === 'string'
  && StyleSheet.flatten(node.props.style)?.width === lightTheme.size.phoneDot.liveDisc
  && StyleSheet.flatten(node.props.style)?.backgroundColor).props.style);
const position = {
  latitude: 25,
  longitude: 121,
  accuracy: 8,
  timestamp: 10000,
  rawSpeedKmh: 5,
  motionState: 'moving',
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  jest.useRealTimers();
});
const render = async (
  value,
  ageSeconds = 0,
  active = true,
  historical = false,
) => {
  await act(async () => {
    const element = (
      <PhoneLocationOverlay
        Circle={Circle}
        Marker={Marker}
        location={{ position: value, ageSeconds, running: true }}
        active={active}
        historical={historical}
      />
    );
    if (renderer) renderer.update(element);
    else renderer = Renderer.create(element);
  });
};
afterEach(() => {
  renderer = null;
});

test('publishes live animated coordinates but never history playback coordinates', async () => {
  const live = {
    running: true,
    sessionId: 'session-a',
    ageSeconds: 0,
    position,
  };
  await act(async () => {
    renderer = Renderer.create(
      <PhoneLocationOverlay Circle={Circle} Marker={Marker} location={live} />,
    );
  });
  expect(locationTrackerNative.displayPosition).toHaveBeenCalledWith(
    'session-a',
    10000,
    25,
    121,
  );
  await act(async () =>
    renderer.update(
      <PhoneLocationOverlay
        Circle={Circle}
        Marker={Marker}
        location={{
          ...live,
          position: { ...position, latitude: 25.001, timestamp: 11000 },
        }}
      />,
    ),
  );
  await act(async () => jest.advanceTimersByTime(400));
  const args = locationTrackerNative.displayPosition.mock.calls.at(-1);
  expect(args[2]).toBeGreaterThan(25);
  expect(args[2]).toBeLessThan(25.001);
  await act(async () =>
    renderer.update(
      <PhoneLocationOverlay
        Circle={Circle}
        Marker={Marker}
        historical
        location={live}
      />,
    ),
  );
  locationTrackerNative.displayPosition.mockClear();
  await act(async () => jest.advanceTimersByTime(1000));
  expect(locationTrackerNative.displayPosition).not.toHaveBeenCalled();
  expect(locationTrackerNative.clearDisplayPosition).toHaveBeenCalledWith(
    'session-a',
  );
});

test('resume never labels the old coordinate with the fresh fix timestamp', async () => {
  const live = { running: true, sessionId: 'a', ageSeconds: 0, position };
  await act(async () => {
    renderer = Renderer.create(
      <PhoneLocationOverlay Circle={Circle} Marker={Marker} location={live} />,
    );
  });
  await act(async () =>
    renderer.update(
      <PhoneLocationOverlay
        Circle={Circle}
        Marker={Marker}
        active={false}
        location={live}
      />,
    ),
  );
  locationTrackerNative.displayPosition.mockClear();
  const next = { ...position, latitude: 25.03, timestamp: 70000 };
  await act(async () =>
    renderer.update(
      <PhoneLocationOverlay
        Circle={Circle}
        Marker={Marker}
        location={{ ...live, position: next }}
      />,
    ),
  );
  expect(locationTrackerNative.displayPosition.mock.calls[0]).toEqual([
    'a',
    70000,
    next.latitude,
    next.longitude,
  ]);
});

test('history dot animates refreshes without stale styling or interpolating long gaps', async () => {
  const first = Object.freeze({
    latitude: 25,
    longitude: 121,
    timestamp: 10000,
    rawSpeedKmh: 5,
  });
  await render(first, 3600, true, true);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  const next = Object.freeze({ ...first, latitude: 25.001, timestamp: 20000 });
  await render(next, 3600, true, true);
  await act(async () => jest.advanceTimersByTime(400));
  expect(
    renderer.root.findByType(Marker).props.coordinate.latitude,
  ).toBeGreaterThan(first.latitude);
  expect(
    renderer.root.findByType(Marker).props.coordinate.latitude,
  ).toBeLessThan(next.latitude);
  await act(async () => jest.advanceTimersByTime(400));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(
    next.latitude,
  );
  const gap = { ...next, latitude: 25.002, timestamp: 200001 };
  await render(gap, 3600, true, true);
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(
    gap.latitude,
  );
  expect(first.latitude).toBe(25);
});

test('dot and accuracy circle move together without mutating GPS samples', async () => {
  await render(position);
  const next = Object.freeze({
    ...position,
    latitude: 25.0001,
    timestamp: 11000,
  });
  await render(next);
  await act(async () => jest.advanceTimersByTime(400));
  const halfway = renderer.root.findByType(Marker).props.coordinate;
  expect(halfway.latitude).toBeGreaterThan(25);
  expect(halfway.latitude).toBeLessThan(next.latitude);
  expect(renderer.root.findByType(Circle).props.center).toEqual(halfway);
  expect(renderer.root.findByType(Circle).props.radius).toBe(8);
  await act(async () => jest.advanceTimersByTime(400));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(
    next.latitude,
  );
  expect(next.latitude).toBe(25.0001);
});

test('stationary locks immediately, stale shows last fix and inactive cancels timers', async () => {
  await render(position);
  const locked = {
    ...position,
    latitude: 25.0002,
    timestamp: 11000,
    motionState: 'stationary',
  };
  await render(locked);
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(
    locked.latitude,
  );
  await render(locked, 4);
  expect(renderer.root.findByType(Circle).props.fillColor).toBe(lightTheme.literalColors.phoneAccuracyFill);
  await render({ ...position, timestamp: 12000, rawSpeedKmh: 60 });
  await act(async () => jest.advanceTimersByTime(300));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(
    position.latitude,
  );
  await render({ ...position, latitude: 25.0003, timestamp: 13000 });
  const cleared = jest.spyOn(global, 'clearInterval');
  await render({ ...position, latitude: 25.0003, timestamp: 13000 }, 0, false);
  expect(cleared).toHaveBeenCalled();
  cleared.mockRestore();
});

test('the dot follows its view until laid out once, then keeps one bitmap redrawn when the map is back', async () => {
  const redraw = jest.fn();
  const RefMarker = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ redraw }));
    return <Marker {...props} />;
  });
  const element = redrawKey => (
    <PhoneLocationOverlay Circle={Circle} Marker={RefMarker} redrawKey={redrawKey}
      location={{ position, ageSeconds: 0, running: true }} />
  );
  await act(async () => { renderer = Renderer.create(element(0)); });
  const marker = () => renderer.root.findByType(Marker);
  // A bitmap taken before layout was empty (no dot, no 「手機」) for good.
  expect(marker().props.tracksViewChanges).toBe(true);
  const container = renderer.root.findAll(node => typeof node.type === 'string' && node.props.collapsable === false)[0];
  await act(async () => container.props.onLayout({ nativeEvent: { layout: { width: 80, height: 60 } } }));
  await act(async () => { jest.runOnlyPendingTimers(); });
  expect(marker().props.tracksViewChanges).toBe(false);
  expect(redraw).toHaveBeenCalled();
  redraw.mockClear();
  // The map came back on screen (or a new instance loaded): one redraw.
  await act(async () => renderer.update(element(1)));
  expect(redraw).toHaveBeenCalledTimes(1);
  expect(marker().props.tracksViewChanges).toBe(false);
});

test('phone name is a capsule and the expanded bitmap stays anchored on the dot', async () => {
  await render(position);
  const tag = renderer.root.findAllByProps({ testID: 'phone-name-tag' }).find(node => typeof node.type === 'string');
  expect(StyleSheet.flatten(tag.props.style)).toMatchObject({ borderRadius: 999, paddingHorizontal: 8 });
  expect(tag.findByType(Text).props.children).toBe(i18nT('c055'));
  const marker = renderer.root.findByType(Marker);
  const container = renderer.root.findAll(node => typeof node.type === 'string' && node.props.collapsable === false)[0];
  const frame = StyleSheet.flatten(container.props.style);
  expect(marker.props.anchor.y * frame.height).toBe(15);
  expect(frame.width).toBeGreaterThan(30);
});


test.each([['light', lightTheme], ['dark', darkTheme]])('ordinary no-update age keeps phone colour, anchor and last fix time in %s theme', async (name, theme) => {
  const live = Object.freeze({ running: true, sessionId: 'unchanged', ageSeconds: 0, position: Object.freeze({ ...position }) });
  const element = location => <ThemeScope theme={theme}><PhoneLocationOverlay Circle={Circle} Marker={Marker} location={location} /></ThemeScope>;
  await act(async () => { renderer = Renderer.create(element(live)); });
  const marker = () => renderer.root.findByType(Marker);
  const initialAnchor = marker().props.anchor;
  const initialDot = dotStyle().backgroundColor;
  const initialCircle = renderer.root.findByType(Circle).props;
  for (const ageSeconds of [4, 601, null]) {
    await act(async () => renderer.update(element({ ...live, ageSeconds })));
    locationTrackerNative.displayPosition.mockClear();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(marker().props.coordinate).toEqual({ latitude: position.latitude, longitude: position.longitude });
    expect(marker().props.anchor).toEqual(initialAnchor);
    expect(dotStyle().backgroundColor).toBe(initialDot);
    expect(renderer.root.findByType(Circle).props.fillColor).toBe(initialCircle.fillColor);
    expect(renderer.root.findByType(Circle).props.strokeColor).toBe(initialCircle.strokeColor);
    expect(locationTrackerNative.displayPosition).not.toHaveBeenCalled();
  }
  expect(live.position.timestamp).toBe(10000);
});

test('age fence cancels an in-flight interpolation and native display publication without mutating the fix', async () => {
  const live = { running: true, sessionId: 'a', ageSeconds: 0, position };
  const element = location => <PhoneLocationOverlay Circle={Circle} Marker={Marker} location={location} />;
  await act(async () => { renderer = Renderer.create(element(live)); });
  const next = Object.freeze({ ...position, latitude: 25.002, timestamp: 11000 });
  await act(async () => renderer.update(element({ ...live, position: next })));
  await act(async () => jest.advanceTimersByTime(200));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBeGreaterThan(25);
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBeLessThan(next.latitude);
  await act(async () => renderer.update(element({ ...live, ageSeconds: 4, position: next })));
  locationTrackerNative.displayPosition.mockClear();
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(next.latitude);
  await act(async () => jest.advanceTimersByTime(2000));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(next.latitude);
  expect(locationTrackerNative.displayPosition).not.toHaveBeenCalled();
  expect(locationTrackerNative.clearDisplayPosition).toHaveBeenCalledWith('a');
  expect(next).toEqual({ ...position, latitude: 25.002, timestamp: 11000 });
});

test.each([
  ['permission/service problem', true, true, true],
  ['confirmed stopped', false, false, true],
  ['unknown recording state', false, null, false],
])('%s is distinct from ordinary age, never published as a fresh display fix', async (name, phoneProblem, running, muted) => {
  const location = { position, ageSeconds: 0, sessionId: 'a', running };
  await act(async () => { renderer = Renderer.create(<PhoneLocationOverlay Circle={Circle} Marker={Marker} location={location} phoneProblem={phoneProblem} />); });
  expect(dotStyle().backgroundColor)
    .toBe(muted ? lightTheme.literalColors.stalePhoneDot : lightTheme.literalColors.phoneDot);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(locationTrackerNative.displayPosition).not.toHaveBeenCalled();
});

test.each([
  ['live moving', false, 'moving', 0],
  ['live stationary', false, 'stationary', 0],
  ['live stale', false, 'moving', 9],
  ['history last position', true, 'moving', 0],
])('%s phone dot has no title, description or press handler, so no info window opens', async (name, historical, motionState, age) => {
  await render({ ...position, motionState }, age, true, historical);
  const props = renderer.root.findByType(Marker).props;
  expect(props.title).toBeUndefined();
  expect(props.description).toBeUndefined();
  expect(props.onPress).toBeUndefined();
  // The 「手機」 name tag still names the dot.
  expect(renderer.root.findByProps({ testID: 'phone-name-tag' })).toBeTruthy();
});
