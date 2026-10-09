// 068: a long day on the history screen (history-long-day: my route since
// 00:30, a fix every 2 s). A cursor move or a feed refresh must not redo the
// whole day: the list re-renders only the rows that changed, the map keeps
// the route pieces the cursor did not touch, and the tracking state does not
// change on every one-second refresh.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import HistoryTimelineList from '../src/mapHistory/HistoryTimelineList';
import * as HistoryText from '../src/history/HistoryText';
import { routeLines } from '../src/history/screen/HistoryMapModel';
import { createTrackingSourceState, trackingSourceReducer } from '../src/tracking/TrackingSourceState';

function Harness({ fixture, onScreen }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `long:${fixture.name}:`,
    recording: fixture.livePhone ? !!fixture.livePhone.running : null, preset: fixture.historyView ?? null });
  onScreen(screen);
  return null;
}

async function longDay() {
  const fixture = buildFixture('history-long-day');
  const state = { screen: null };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<Harness fixture={fixture} onScreen={value => { state.screen = value; }} />);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => {});
  await act(async () => renderer.unmount());
  return state.screen;
}

test('the long-day fixture is a long day', async () => {
  const screen = await longDay();
  expect(screen.model.points.length).toBeGreaterThan(5000);
});

test('a cursor move re-renders only the rows it lights and unlights', async () => {
  const { model } = await longDay();
  const stays = model.nodes.filter(node => node.type === 'stop');
  expect(stays.length).toBeGreaterThan(4);
  const spy = jest.spyOn(HistoryText, 'placeLines');
  const press = () => {};
  const layout = () => {};
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<HistoryTimelineList model={model} color="#2a6fdb" selected={stays[1].start}
      onPressNode={press} onRowLayout={layout} />);
  });
  const rows = spy.mock.calls.length;
  expect(rows).toBeGreaterThan(stays.length);
  spy.mockClear();
  await act(async () => {
    renderer.update(<HistoryTimelineList model={model} color="#2a6fdb" selected={stays[3].start}
      onPressNode={press} onRowLayout={layout} />);
  });
  // The row unlit and the row lit.
  expect(spy.mock.calls.length).toBe(2);
  spy.mockClear();
  // The parent re-rendering with the same props: nothing.
  await act(async () => {
    renderer.update(<HistoryTimelineList model={model} color="#2a6fdb" selected={stays[3].start}
      onPressNode={press} onRowLayout={layout} />);
  });
  expect(spy.mock.calls.length).toBe(0);
  spy.mockRestore();
  await act(async () => renderer.unmount());
});

test('a cursor move keeps the route pieces it did not reach', async () => {
  const { model } = await longDay();
  const edges = model.edges;
  const early = edges[Math.floor(edges.length * 0.6)].start;
  const late = edges[Math.floor(edges.length * 0.7)].start;
  const before = routeLines(edges, { color: '#2a6fdb', cursorTime: early });
  const after = routeLines(edges, { color: '#2a6fdb', cursorTime: late });
  const ids = new Set(after.map(line => line.id));
  const kept = before.filter(line => ids.has(line.id));
  // Everything outside the stretch the cursor moved over is the same piece.
  expect(kept.length).toBeGreaterThan(before.length * 0.7);
  for (const line of after) expect(line.coordinates.length).toBeLessThanOrEqual(201);
});

test('a one-second feed refresh leaves the tracking state alone', () => {
  let state = createTrackingSourceState();
  state = trackingSourceReducer(state, { type: 'caught-up', source: 'real' });
  const settled = state;
  state = trackingSourceReducer(state, { type: 'refreshing', source: 'real' });
  state = trackingSourceReducer(state, { type: 'caught-up', source: 'real' });
  expect(state).toBe(settled);
});
