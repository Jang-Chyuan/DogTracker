import React from 'react';
import { PanResponder } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Polyline } from 'react-native-svg';
import ActivityHistoryChart from '../src/map/ActivityHistoryChart';

test('chart leaves gaps and stops database polling in background', async () => {
  jest.useFakeTimers();
  const data = Array.from({ length: 1440 }, (_, i) => ({ time: i * 60000,
    value: [0, 1, 3, 4].includes(i) ? 0.475 : null }));
  const database = { activityHistory: jest.fn(async () => data) };
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<ActivityHistoryChart database={database} slaveId={8} owner="a" active />); });
    expect(renderer.root.findAllByType(Polyline)).toHaveLength(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(60000); });
    expect(database.activityHistory).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.update(<ActivityHistoryChart database={database} slaveId={8} owner="a" active={false} />); });
    await act(async () => { await jest.advanceTimersByTimeAsync(120000); });
    expect(database.activityHistory).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.update(<ActivityHistoryChart database={database} slaveId={8} owner="b" active={false} />); });
    expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  } finally {
    await act(async () => { renderer?.unmount(); });
    jest.useRealTimers();
  }
});

test('fixed 24-hour history supports zoom and pan without range selection buttons', async () => {
  jest.useFakeTimers();
  const data = Array.from({ length: 1440 }, (_, i) => ({ time: Date.parse('2026-09-27T00:00:00Z') + i * 60000, value: 0.4 }));
  const database = { activityHistory: jest.fn(async () => data) };
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<ActivityHistoryChart database={database} slaveId={8} owner="a" active dogAliases={{ 8: 'Hermes' }} />); });
    expect(renderer.root.findByType(Polyline).props.points.split(' ')).toHaveLength(1440);
    const choose = title => renderer.root.findAll(p => p.props.accessibilityLabel === title && typeof p.props.onPress === 'function')[0].props.onPress();
    expect(renderer.root.findAll(p => typeof p.props.onPress === 'function' && /\d+ 小時/.test(p.props.accessibilityLabel || ''))).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Hermes');
    expect(JSON.stringify(renderer.toJSON())).toContain('時間軸：');
    await act(async () => { choose('放大時間軸'); });
    expect(renderer.root.findByType(Polyline).props.points.split(' ')).toHaveLength(720);
    const latestView = JSON.stringify(renderer.toJSON());
    await act(async () => { choose('查看較早活動'); });
    expect(JSON.stringify(renderer.toJSON())).not.toBe(latestView);
    await act(async () => { choose('查看較新活動'); });
    expect(JSON.stringify(renderer.toJSON())).toBe(latestView);
    await act(async () => { choose('重設時間軸'); });
    expect(renderer.root.findByType(Polyline).props.points.split(' ')).toHaveLength(1440);
    expect(database.activityHistory).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { renderer?.unmount(); });
    jest.useRealTimers();
  }
});

test('horizontal pinch zoom is bounded and does not capture vertical scrolling', async () => {
  jest.useFakeTimers();
  const spy = jest.spyOn(PanResponder, 'create');
  const database = { activityHistory: jest.fn(async () => Array.from({ length: 1440 }, (_, i) => ({ time: i * 60000, value: i / 1440 }))) };
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<ActivityHistoryChart database={database} slaveId={8} owner="a" active />); });
    const handlers = spy.mock.calls[0][0];
    const event = (span, center = 97) => ({ nativeEvent: { touches: [{ pageX: center - span / 2 }, { pageX: center + span / 2 }] } });
    expect(handlers.onMoveShouldSetPanResponder({ nativeEvent: { touches: [{ pageX: 10 }] } })).toBe(false);
    handlers.onPanResponderGrant(event(100));
    await act(async () => { handlers.onPanResponderMove(event(200)); });
    expect(renderer.root.findByType(Polyline).props.points.split(' ')).toHaveLength(720);
    // Midpoint at one-quarter of the plot retains that time under the fingers:
    // the window starts at minute 180, rather than the latest 720 minutes.
    const firstY = () => Number(renderer.root.findByType(Polyline).props.points.split(' ')[0].split(',')[1]);
    expect(firstY()).toBeCloseTo(108 - 180 / 1440 * 96);
    await act(async () => { handlers.onPanResponderMove(event(200, 126.2)); });
    expect(firstY()).toBeCloseTo(108 - 108 / 1440 * 96);
    await act(async () => { handlers.onPanResponderMove(event(20)); });
    expect(renderer.root.findByType(Polyline).props.points.split(' ')).toHaveLength(1440);
    expect(database.activityHistory).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { renderer?.unmount(); });
    spy.mockRestore();
    jest.useRealTimers();
  }
});

test('one-finger horizontal drag pans both ways within bounds and can transition to pinch', async () => {
  jest.useFakeTimers();
  const spy = jest.spyOn(PanResponder, 'create');
  const database = { activityHistory: jest.fn(async () => Array.from({ length: 1440 }, (_, i) => ({ time: i * 60000, value: i / 1440 }))) };
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<ActivityHistoryChart database={database} slaveId={8} owner="a" active />); });
    const handlers = spy.mock.calls[0][0];
    const event = x => ({ nativeEvent: { touches: [{ pageX: x }] } });
    expect(handlers.onMoveShouldSetPanResponder(event(100), { dx: 30, dy: 0 })).toBe(false);
    await act(async () => { renderer.root.findAll(p => p.props.accessibilityLabel === '放大時間軸' && typeof p.props.onPress === 'function')[0].props.onPress(); });
    expect(handlers.onMoveShouldSetPanResponder(event(100), { dx: 30, dy: 0 })).toBe(true);
    expect(handlers.onMoveShouldSetPanResponder(event(100), { dx: 2, dy: 30 })).toBe(false);
    const firstY = () => Number(renderer.root.findByType(Polyline).props.points.split(' ')[0].split(',')[1]);
    handlers.onPanResponderGrant(event(100));
    await act(async () => { handlers.onPanResponderMove(event(246)); });
    expect(firstY()).toBeCloseTo(108 - 360 / 1440 * 96);
    await act(async () => { handlers.onPanResponderMove(event(100)); });
    expect(firstY()).toBeCloseTo(108 - 720 / 1440 * 96);
    await act(async () => { handlers.onPanResponderMove(event(-1000)); });
    expect(firstY()).toBeCloseTo(108 - 720 / 1440 * 96);
    await act(async () => { handlers.onPanResponderMove(event(2000)); });
    expect(firstY()).toBe(108);
    const pinch = span => ({ nativeEvent: { touches: [{ pageX: 160 - span / 2 }, { pageX: 160 + span / 2 }] } });
    await act(async () => { handlers.onPanResponderMove(pinch(100)); });
    await act(async () => { handlers.onPanResponderMove(pinch(200)); });
    expect(renderer.root.findByType(Polyline).props.points.split(' ')).toHaveLength(360);
    const before = firstY();
    await act(async () => { handlers.onPanResponderMove(event(100)); });
    expect(firstY()).toBe(before);
    handlers.onPanResponderRelease();
    expect(database.activityHistory).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { renderer?.unmount(); });
    spy.mockRestore();
    jest.useRealTimers();
  }
});
