import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder, StyleSheet } from 'react-native';
import { HistoryRangeControls } from '../src/mapHistory/HistoryRangeSummary';
import HistoryCursor from '../src/mapHistory/HistoryCursor';
import { dragTimeTipBox } from '../src/mapHistory/HistoryDragTimeTip';
import { clock } from '../src/history/HistoryText';
import { space } from '../src/theme/tokens';

const START = new Date(2026, 9, 10).getTime(), HOUR = 3600000;
const points = Array.from({ length: 24 * 60 }, (_, i) => ({ time: START + i * 60000 }));
let tree, handlers;
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers = value; return { panHandlers: {} }; });
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = null; jest.restoreAllMocks(); jest.useRealTimers(); });
const tip = id => tree.root.findAll(node => node.type === 'View' && node.props.testID === id);
const text = id => tip(id)[0]?.findByType('Text').props.children;
async function rangeControls() {
  const commit = jest.fn(), preview = jest.fn(), begin = jest.fn();
  const props = { model: { dayPoints: points }, range: { start: START + HOUR, end: START + 22 * HOUR, following: false },
    track: { start: START, end: START + 24 * HOUR }, today: false,
    onBegin: begin, onDrag: preview, onCommit: commit };
  await act(async () => { tree = Renderer.create(<HistoryRangeControls {...props} />); });
  const track = tree.root.findAll(node => node.type === 'View' && typeof node.props.onLayout === 'function')[0];
  await act(async () => track.props.onLayout({ nativeEvent: { layout: { width: 348 } } }));
  return { props, commit, preview, begin };
}

test.each(['start', 'end'])('dragging %s immediately shows the same 24-hour time above the handle without scheduling a model preview', async handle => {
  const state = await rangeControls();
  const bar = () => tree.root.findAll(node => node.type === 'View' && node.props.testID === 'history-range-bar')[0];
  const beforeStyle = StyleSheet.flatten(bar().props.style);
  expect(beforeStyle.paddingTop).toBeUndefined();
  expect(tip('history-range-drag-time')).toHaveLength(0);
  await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: handle === 'start' ? 35 : 320, pageX: 500 } }));
  expect(text('history-range-drag-time')).toBe(handle === 'start' ? '01:00' : '22:00');
  await act(async () => handlers.onPanResponderMove({ nativeEvent: { pageX: handle === 'start' ? 525 : 475 } }, { dx: handle === 'start' ? 25 : -25 }));
  const spoken = tree.root.findAll(node => node.type === 'View' && node.props.testID === `range-handle-${handle}`)[0].props.accessibilityLabel;
  expect(spoken).toContain(text('history-range-drag-time'));
  expect(text('history-range-drag-time')).not.toBe(handle === 'start' ? '01:00' : '22:00');
  expect(tip('history-range-drag-time')[0].props).toMatchObject({ pointerEvents: 'none', accessibilityElementsHidden: true });
  const box = StyleSheet.flatten(tip('history-range-drag-time')[0].props.style);
  expect(box.position).toBe('absolute');
  expect(box.top + box.minHeight).toBe(-space.s); // floats above the handle, with no reserved lane
  expect(StyleSheet.flatten(bar().props.style)).toEqual(beforeStyle);
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(state.begin).toHaveBeenCalledTimes(1);
  expect(state.preview).not.toHaveBeenCalled(); expect(state.commit).not.toHaveBeenCalled();
  await act(async () => handlers.onPanResponderRelease({ nativeEvent: { pageX: handle === 'start' ? 525 : 475 } }, {}));
  expect(state.commit).toHaveBeenCalledTimes(1); expect(tip('history-range-drag-time')).toHaveLength(0);
  expect(StyleSheet.flatten(bar().props.style)).toEqual(beforeStyle);
});

test('scope changes and termination hide the hint; TalkBack remains adjustable without a duplicate spoken overlay', async () => {
  const state = await rangeControls();
  await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: 320 } }));
  await act(async () => tree.update(<HistoryRangeControls {...state.props} previewScope="new-day" />));
  expect(tip('history-range-drag-time')).toHaveLength(0);
  await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: 320 } }));
  await act(async () => handlers.onPanResponderTerminate({}, { dx: -10 }));
  expect(tip('history-range-drag-time')).toHaveLength(0);
  const end = tree.root.findAll(node => node.type === 'View' && node.props.testID === 'range-handle-end')[0];
  await act(async () => end.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
  expect(state.commit).toHaveBeenCalled(); expect(tip('history-range-drag-time')).toHaveLength(0);
});

test.each([1, 2])('clock box stays within both horizontal edges and its upper viewport bound at font scale %s', scale => {
  for (const width of [180, 348, 851]) for (const x of [-40, 0, width, width + 40]) {
    const box = dragTimeTipBox(x, width, 15, 8, scale);
    expect(box.left).toBeGreaterThanOrEqual(space.s);
    expect(box.left + box.width).toBeLessThanOrEqual(width - space.s);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.minHeight).toBeGreaterThanOrEqual(36);
  }
});

test('map cursor hint follows accepted snapped display time and vanishes on release even when the last coordinate read returns late', async () => {
  let resolve;
  const route = [0, 1, 2].map(i => ({ time: START + (18 * 60 + i) * 60000, latitude: 25, longitude: 121 + i * .001 }));
  const mapRef = { current: {
    pointForCoordinate: async p => ({ x: 50 + (p.longitude - 121) * 100000, y: 300 }),
    coordinateForPoint: jest.fn(() => new Promise(done => { resolve = done; })),
  } };
  let current;
  function Probe() {
    const [point, setPoint] = useState(route[0]); current = point;
    return <HistoryCursor mapRef={mapRef} cursor={{ time: point.time, coordinate: point, lines: [clock(point.time)] }}
      points={route} width={400} height={800} top={80} bottom={100} onMove={time => setPoint(route.find(p => p.time === time))} />;
  }
  await act(async () => { tree = Renderer.create(<Probe />); });
  await act(async () => handlers.onPanResponderGrant());
  expect(text('history-cursor-drag-time')).toBe('18:00');
  await act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
  expect(text('history-cursor-drag-time')).toBe('18:00'); // unaccepted SDK response cannot fabricate time
  await act(async () => resolve({ latitude: 25, longitude: route[1].longitude }));
  expect(text('history-cursor-drag-time')).toBe('18:01');
  expect(current.time).toBe(route[1].time);
  await act(async () => handlers.onPanResponderMove(null, { dx: 200, dy: 0 }));
  await act(async () => handlers.onPanResponderRelease());
  expect(tip('history-cursor-drag-time')).toHaveLength(0);
  await act(async () => resolve({ latitude: 25, longitude: route[2].longitude }));
  expect(current.time).toBe(route[2].time);
  expect(tip('history-cursor-drag-time')).toHaveLength(0);
});

// The requested transient clock can overlap content; it never grows the sheet.
test.each([1, 2])('clock floats fully above its handle at font scale %s', scale => {
  const box = dragTimeTipBox(300, 348, 0, -Infinity, scale);
  expect(box.top).toBeLessThan(0);
  expect(box.top + box.minHeight).toBe(-space.s);
});
