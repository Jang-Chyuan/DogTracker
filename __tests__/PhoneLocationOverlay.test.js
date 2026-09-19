import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Circle, Marker } from 'react-native-maps';
import PhoneLocationOverlay from '../src/map/PhoneLocationOverlay';
import { locationTrackerNative } from '../src/locationTracker/LocationTrackerService';

jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { displayPosition: jest.fn(), clearDisplayPosition: jest.fn() },
}));

let renderer;
const position = { latitude: 25, longitude: 121, accuracy: 8, timestamp: 10000, rawSpeedKmh: 5, motionState: 'moving' };
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  jest.useRealTimers();
});
const render = async (value, ageSeconds = 0, active = true, historical = false) => {
  await act(async () => {
    const element = <PhoneLocationOverlay location={{ position: value, ageSeconds }} active={active} historical={historical} />;
    if (renderer) renderer.update(element);
    else renderer = Renderer.create(element);
  });
};
afterEach(() => { renderer = null; });

test('publishes live animated coordinates but never history playback coordinates', async () => {
  const live = { running: true, sessionId: 'session-a', ageSeconds: 0, position };
  await act(async () => { renderer = Renderer.create(<PhoneLocationOverlay location={live} />); });
  expect(locationTrackerNative.displayPosition).toHaveBeenCalledWith('session-a', 10000, 25, 121);
  await act(async () => renderer.update(<PhoneLocationOverlay location={{ ...live,
    position: { ...position, latitude: 25.001, timestamp: 11000 } }} />));
  await act(async () => jest.advanceTimersByTime(400));
  const args = locationTrackerNative.displayPosition.mock.calls.at(-1);
  expect(args[2]).toBeGreaterThan(25);
  expect(args[2]).toBeLessThan(25.001);
  await act(async () => renderer.update(<PhoneLocationOverlay historical location={live} />));
  locationTrackerNative.displayPosition.mockClear();
  await act(async () => jest.advanceTimersByTime(1000));
  expect(locationTrackerNative.displayPosition).not.toHaveBeenCalled();
  expect(locationTrackerNative.clearDisplayPosition).toHaveBeenCalledWith('session-a');
});

test('history dot animates refreshes without stale styling or interpolating long gaps', async () => {
  const first = Object.freeze({ latitude: 25, longitude: 121, timestamp: 10000, rawSpeedKmh: 5 });
  await render(first, 3600, true, true);
  expect(renderer.root.findByType(Marker).props.title).toBe('手機 · 歷史最後位置');
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  const next = Object.freeze({ ...first, latitude: 25.001, timestamp: 20000 });
  await render(next, 3600, true, true);
  await act(async () => jest.advanceTimersByTime(400));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBeGreaterThan(first.latitude);
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBeLessThan(next.latitude);
  await act(async () => jest.advanceTimersByTime(400));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(next.latitude);
  const gap = { ...next, latitude: 25.002, timestamp: 200001 };
  await render(gap, 3600, true, true);
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(gap.latitude);
  expect(first.latitude).toBe(25);
});

test('dot and accuracy circle move together without mutating GPS samples', async () => {
  await render(position);
  const next = Object.freeze({ ...position, latitude: 25.0001, timestamp: 11000 });
  await render(next);
  await act(async () => jest.advanceTimersByTime(400));
  const halfway = renderer.root.findByType(Marker).props.coordinate;
  expect(halfway.latitude).toBeGreaterThan(25);
  expect(halfway.latitude).toBeLessThan(next.latitude);
  expect(renderer.root.findByType(Circle).props.center).toEqual(halfway);
  expect(renderer.root.findByType(Circle).props.radius).toBe(8);
  await act(async () => jest.advanceTimersByTime(400));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(next.latitude);
  expect(next.latitude).toBe(25.0001);
});

test('stationary locks immediately, stale shows last fix and inactive cancels timers', async () => {
  await render(position);
  const locked = { ...position, latitude: 25.0002, timestamp: 11000, motionState: 'stationary' };
  await render(locked);
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(locked.latitude);
  expect(renderer.root.findByType(Marker).props.title).toContain('靜止鎖定');
  await render(locked, 4);
  expect(renderer.root.findByType(Marker).props.title).toContain('已過期');
  expect(renderer.root.findByType(Circle).props.fillColor).toContain('100,116,139');
  await render({ ...position, timestamp: 12000, rawSpeedKmh: 60 });
  await act(async () => jest.advanceTimersByTime(300));
  expect(renderer.root.findByType(Marker).props.coordinate.latitude).toBe(position.latitude);
  await render({ ...position, latitude: 25.0003, timestamp: 13000 });
  const cleared = jest.spyOn(global, 'clearInterval');
  await render({ ...position, latitude: 25.0003, timestamp: 13000 }, 0, false);
  expect(cleared).toHaveBeenCalled();
  cleared.mockRestore();
});
