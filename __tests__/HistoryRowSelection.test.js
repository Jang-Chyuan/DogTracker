// 2026-10-14: the history map and the timeline list follow each other by
// row. Any row can be the selected one (a drag or a tap on the route picks
// the row the cursor is in; a tap on a row picks it and frames a movement /
// 沒有資料 row's segment); nothing is selected on opening; the map draws the
// selected movement row's segment wider on a casing with its glyph, and a
// selected stay's number solid.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen, { followRowOffset, HISTORY_LIST_SCROLL_PAUSE_MS } from '../src/mapHistory/HistoryScreen';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { rowKey, rowSelection } from '../src/history/screen/HistoryScreenCursor';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { labelBoxAround, timeUnderLabel } from '../src/mapHistory/CursorLabelPlacement';
import { sameHistoryLine } from '../src/map/GoogleTrackingMap';

const LEVELS = { summary: 140, half: 420, full: 620 };

function Harness({ fixture, onScreen }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `selection:${fixture.name}:`,
    preset: fixture.historyView ?? null });
  onScreen?.(screen);
  return <HistoryScreen screen={screen} top={24} levels={LEVELS} bottomInset={0} name="" history={null} />;
}

async function mount(name) {
  const fixture = buildFixture(name);
  const state = { screen: null, renderer: null };
  await act(async () => {
    state.renderer = Renderer.create(<Harness fixture={fixture} onScreen={value => { state.screen = value; }} />);
  });
  await act(async () => {});
  state.selectedRows = () => state.renderer.root.findAll(node => typeof node.type === 'string'
    && node.props.testID === 'timeline-selected');
  state.edges = () => state.renderer.root.findAll(node => typeof node.type === 'string'
    && node.props.testID === 'selected-row-edge');
  return state;
}
const pressable = (state, testID) => state.renderer.root.findAll(node => node.props.testID === testID
  && typeof node.props.onPress === 'function')[0];
const unmount = state => act(async () => state.renderer.unmount());
const rows = state => timelinePresentation(state.screen.model.nodes);

test('nothing is selected on opening: no lit row, an even route, no segment glyph', async () => {
  const s = await mount('history-mode-switch');
  expect(s.screen.selected).toBeNull();
  expect(s.selectedRows()).toHaveLength(0);
  expect(s.screen.map.lines.some(line => line.selected || line.casing)).toBe(false);
  expect(s.screen.map.icon).toBeNull();
  expect(s.screen.map.places.some(place => place.selected)).toBe(false);
  await unmount(s);
});

test('a drag into the car lights that row (fill and edge) and emphasises its segment', async () => {
  const s = await mount('history-mode-switch');
  const car = rows(s).find(row => row.type === 'movement' && row.mode === 'driving');
  await act(async () => s.screen.moveCursor(car.start + (car.end - car.start) / 2, 'drag'));
  expect(s.screen.selected).toMatchObject({ key: rowKey(car), type: 'movement', mode: 'driving', source: 'map' });
  expect(s.selectedRows()).toHaveLength(1);
  expect(s.edges()).toHaveLength(1);
  const chosen = s.screen.map.lines.filter(line => line.selected);
  expect(chosen.length).toBeGreaterThan(0);
  expect(chosen.every(line => line.width === 5 && !line.dotted && line.casing)).toBe(true);
  expect(s.screen.map.icon).toMatchObject({ glyph: 'car' });
  expect(s.screen.cursor.label[1]).toBe('開車中');
  // A drag frames nothing: the map stays where the viewer has it.
  expect(s.screen.segmentFrame).toBeNull();
  // On into the next row: that one is lit instead.
  const walk = rows(s).find(row => row.type === 'movement' && row.start >= car.end);
  await act(async () => s.screen.moveCursor(walk.start + 60000, 'drag'));
  expect(s.screen.selected.key).toBe(rowKey(walk));
  expect(s.selectedRows()).toHaveLength(1);
  expect(s.screen.map.icon).toMatchObject({ glyph: 'walk' });
  expect(s.screen.cursor.label[1]).toMatch(/^走路・已走 /);
  await unmount(s);
});

test('a tapped movement row is selected and its segment framed', async () => {
  const s = await mount('history-mode-switch');
  const walk = rows(s).find(row => row.type === 'movement' && row.mode === 'walking');
  const focus = s.screen.focus;
  await act(async () => pressable(s, 'timeline-movement-walking').props.onPress());
  expect(s.screen.selected).toMatchObject({ key: rowKey(walk), source: 'list' });
  expect(s.screen.segmentFrame.coordinates.length).toBeGreaterThan(2);
  // The frame replaces the cursor's own camera move.
  expect(s.screen.focus).toBe(focus);
  expect(s.selectedRows()).toHaveLength(1);
  await unmount(s);
});

test('a tapped 沒有資料 row is selected and frames the fixes on both sides of the break', async () => {
  const s = await mount('history-gap');
  await act(async () => pressable(s, 'timeline-gap-gap').props.onPress());
  expect(s.screen.selected).toMatchObject({ type: 'gap', source: 'list' });
  expect(s.screen.segmentFrame.coordinates).toHaveLength(2);
  expect(s.screen.cursor.stale).toBe(true);
  expect(s.selectedRows()).toHaveLength(1);
  // A break has no line to emphasise.
  expect(s.screen.map.lines.some(line => line.selected)).toBe(false);
  await unmount(s);
});

test('a stop number tapped on the map selects its stay row and draws the number solid', async () => {
  const s = await mount('history-my-route');
  const place = s.screen.map.places.find(p => p.kind === 'number');
  await act(async () => s.screen.moveCursor(place.start, 'stop', { start: place.start }));
  expect(s.screen.selected).toMatchObject({ type: place.type, start: place.start, source: 'stop' });
  expect(s.screen.map.places.find(p => p.key === place.key).selected).toBe(true);
  expect(s.screen.map.places.filter(p => p.selected)).toHaveLength(1);
  expect(s.selectedRows()).toHaveLength(1);
  await unmount(s);
});

test('another day or a new range lets the selection go', async () => {
  const s = await mount('history-mode-switch');
  const car = rows(s).find(row => row.type === 'movement' && row.mode === 'driving');
  await act(async () => s.screen.moveCursor(car.start + 1000, 'drag'));
  expect(s.screen.selected).not.toBeNull();
  await act(async () => s.screen.changeDay(s.screen.day - 24 * 60 * 60000));
  await act(async () => {});
  expect(s.screen.selected).toBeNull();
  await unmount(s);
});

describe('the list follows the cursor', () => {
  const box = { y: 600, height: 48 };
  const state = { offset: 0, height: 300, manualAt: 0, dragging: false };
  const now = 100000;
  test('a row chosen on the map and out of view: scrolled to, 8dp above it', () => {
    expect(followRowOffset(rowSelection({ type: 'stop', start: 1, end: 2 }, 'map'), box, state, now)).toBe(592);
  });
  test('a row in view, or chosen in the list: no scroll', () => {
    expect(followRowOffset(rowSelection({ type: 'stop', start: 1, end: 2 }, 'map'), { y: 100, height: 48 }, state, now)).toBeNull();
    expect(followRowOffset(rowSelection({ type: 'stop', start: 1, end: 2 }, 'list'), box, state, now)).toBeNull();
  });
  test('the viewer scrolled in the last 3 s or has a finger on the list: no scroll (a stop number still does)', () => {
    const map = rowSelection({ type: 'movement', start: 1, end: 2 }, 'map');
    expect(followRowOffset(map, box, { ...state, manualAt: now - HISTORY_LIST_SCROLL_PAUSE_MS + 1 }, now)).toBeNull();
    expect(followRowOffset(map, box, { ...state, manualAt: now - HISTORY_LIST_SCROLL_PAUSE_MS }, now)).toBe(592);
    expect(followRowOffset(map, box, { ...state, dragging: true }, now)).toBeNull();
    expect(followRowOffset(rowSelection({ type: 'stop', start: 1, end: 2 }, 'stop'), box, { ...state, dragging: true }, now)).toBe(592);
  });
});

describe('time markers under the cursor label', () => {
  const size = { width: 120, height: 44, above: 70, below: 10, pinHalf: 12, pinAbove: 20 };
  const cursor = { latitude: 25, longitude: 121 };
  const north = metres => ({ latitude: 25 + metres / 110540, longitude: 121 });
  test('one under the label is left out; one beside it or below the point stays', () => {
    const box = labelBoxAround({ x: 200, y: 400 }, size, { hidden: false, box: null });
    expect(box).toEqual({ x: -60, y: -70, width: 120, height: 44 });
    // 2 m per dp: 100 m north is 50dp above the point, inside the label.
    expect(timeUnderLabel(north(100), cursor, box, 2)).toBe(true);
    expect(timeUnderLabel(north(-100), cursor, box, 2)).toBe(false);
    expect(timeUnderLabel({ latitude: 25, longitude: 121 + 300 / 100900 }, cursor, box, 2)).toBe(false);
    // The map turned upside down: north is below the point.
    expect(timeUnderLabel(north(100), cursor, box, 2, 180)).toBe(false);
  });
  test('a label moved aside is used where it is; a hidden one hides nothing', () => {
    const moved = labelBoxAround({ x: 200, y: 400 }, size, { hidden: true, box: { x: 220, y: 380, width: 120, height: 44 } });
    expect(moved).toEqual({ x: 20, y: -20, width: 120, height: 44 });
    expect(labelBoxAround({ x: 200, y: 400 }, size, { hidden: true, box: null })).toBeNull();
  });
});

test('a history line without an id is always redrawn; one with an unchanged id is not', () => {
  const line = { id: 'a', coordinates: [] };
  const dashed = [];
  expect(sameHistoryLine({ line, casing: null, dashed }, { line: { ...line }, casing: null, dashed })).toBe(true);
  expect(sameHistoryLine({ line: { coordinates: [] }, casing: null }, { line: { coordinates: [] }, casing: null })).toBe(false);
  expect(sameHistoryLine({ line, casing: null }, { line: { ...line, id: 'b' }, casing: null })).toBe(false);
});

// 2026-10-14 invariant: the list and the map agree on which stays carry a
// number, and no numbered circle is ever drawn without one (an unnumbered
// middle stay is a small plain dot in the list and not on the map).
describe('numbered stays agree between the list and the map', () => {
  const numbersInList = s => s.renderer.root.findAll(node => typeof node.type === 'string'
    && /^node-number-/.test(node.props.testID || '')).map(node => node.props.testID.slice('node-number-'.length));
  test.each(['history-my-route', 'history-walk-drive-stay', 'history-busy-day', 'history-dog',
    'history-starts-with-stay', 'history-mode-switch', 'history-multi-dog'])('%s', async name => {
    const s = await mount(name);
    const listed = numbersInList(s);
    expect(listed).not.toContain('undefined');
    expect(listed).not.toContain('null');
    const onMap = s.screen.map.places.filter(place => place.kind === 'number')
      .flatMap(place => (place.group || [place]).map(p => String(p.number)));
    expect([...listed].sort()).toEqual([...onMap].sort());
    expect(s.screen.map.places.every(place => place.kind !== 'number' || place.number != null)).toBe(true);
    await unmount(s);
  });

  test('a stay without a number is a plain dot, never an empty numbered circle; selected numbers go solid', async () => {
    const HistoryTimelineList = require('../src/mapHistory/HistoryTimelineList').default;
    const { StyleSheet } = require('react-native');
    const at = minutes => 1791331200000 + minutes * 60000;
    const place = (type, start, end, extra = {}) => ({ type, start: at(start), end: at(end), latitude: 25, longitude: 121, ...extra });
    const move = (start, end) => ({ type: 'movement', mode: 'walking', start: at(start), end: at(end),
      durationMs: at(end) - at(start), distanceM: 300, countedDistanceM: 300 });
    const nodes = [place('departure', 0, 0), move(0, 10), place('stop', 10, 20, { number: null, durationMs: 600000 }),
      move(20, 30), place('stop', 30, 40, { number: 1, durationMs: 600000 }), move(40, 50), place('end', 50, 50)];
    let renderer;
    await act(async () => {
      renderer = Renderer.create(<HistoryTimelineList model={{ nodes }} color="#1A73E8" selectedKey={`stop:${at(30)}`} />);
    });
    const ids = renderer.root.findAll(node => typeof node.type === 'string' && /^node-/.test(node.props.testID || ''))
      .map(node => node.props.testID);
    expect(ids).toEqual(['node-plain-stop', 'node-number-1']);
    const ringOf = () => renderer.root.findAll(node => typeof node.type === 'string'
      && node.props.testID === 'node-number-1')[0].children[0];
    expect(StyleSheet.flatten(ringOf().props.style).backgroundColor).toBe('#1A73E8');
    await act(async () => renderer.update(<HistoryTimelineList model={{ nodes }} color="#1A73E8" selectedKey={null} />));
    expect(StyleSheet.flatten(ringOf().props.style).backgroundColor).not.toBe('#1A73E8');
    await act(async () => renderer.unmount());
  });
});

test('a numbered stay only the list has (presentation-only) is marked on the map too', () => {
  const { historyMapPresentation } = require('../src/history/screen/HistoryMapModel');
  const at = minutes => 1791331200000 + minutes * 60000;
  const stop = (number, start, end, lon) => ({ type: 'stop', number, start: at(start), end: at(end), durationMs: (end - start) * 60000,
    latitude: 25, longitude: lon });
  const kept = stop(1, 10, 20, 121.0), only = { ...stop(2, 30, 40, 121.01), presentationOnly: 'phone-stationary' };
  const points = [0, 10, 20, 30, 40, 50].map(m => ({ time: at(m), latitude: 25, longitude: 121 + m / 5000 }));
  const model = { points, edges: [], locations: [kept], nodes: [kept, only] };
  const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
  expect(map.places.filter(p => p.kind === 'number').map(p => p.number)).toEqual([1, 2]);
  // The same array on a cursor move (no new native projections).
  expect(historyMapPresentation(model, { color: '#1A73E8', subject: 'phone', cursor: { point: points[2] } }).places).toBe(map.places);
});
