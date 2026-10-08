// 057a: how each day's time-line list ends (判定表「清單節點的內容」「「現在」和
// 「最後 12:05」」「記錄被迫中止的終點膠囊」, 接續隔天), through useHistoryScreen
// as MapScreen drives it (recording from the phone's live state).
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { nodePill } from '../src/history/HistoryText';

function Harness({ fixture, onScreen }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `end:${fixture.name}:`,
    recording: fixture.livePhone ? !!fixture.livePhone.running : null,
    preset: fixture.historyView ?? null });
  onScreen(screen);
  return null;
}

async function open(name) {
  const fixture = buildFixture(name);
  const state = { screen: null };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<Harness fixture={fixture} onScreen={value => { state.screen = value; }} />);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => {});
  const nodes = state.screen.model?.nodes ?? [];
  const last = nodes[nodes.length - 1];
  await act(async () => renderer.unmount());
  return { screen: state.screen, last, fixture };
}

const clock = time => new Date(time).toTimeString().slice(0, 5);

test.each([
  ['history-my-route', '現在'],
  ['history-dog', '現在'],
  ['history-multi-dog', '現在'],
])('%s ends on 「%s」 (the last fix within 2 minutes)', async (name, label) => {
  const { last } = await open(name);
  expect(last).toMatchObject({ type: 'end', label });
});

test('a dog without a fix for 17 minutes, following now: 「最後 09:13」', async () => {
  const { last } = await open('history-dog-stale');
  expect(last).toMatchObject({ type: 'end', label: '最後' });
  expect(nodePill(last)).toEqual({ text: '最後 09:13', tone: 'plain' });
});

test('only the end dragged back to 08:50: 「結束」 at that time, the start still 「出發」', async () => {
  const { last, screen } = await open('history-manual-end');
  expect(nodePill(screen.model.nodes[0])).toEqual({ text: '出發', tone: 'plain' });
  expect(last).toMatchObject({ type: 'end', label: '結束' });
  expect(clock(last.end)).toBe('08:50');
});

test('recording switched off at 09:05: 「記錄已關閉 09:05」, not 「結束」', async () => {
  const { last } = await open('history-recording-off');
  expect(last).toMatchObject({ type: 'end', label: '記錄已關閉' });
  expect(clock(last.closedAt)).toBe('09:05');
  expect(nodePill(last)).toEqual({ text: '記錄已關閉 09:05', tone: 'closed' });
});

test('a past day this phone holds opens (preset goTo) and ends on 「結束」', async () => {
  const { screen, last } = await open('history-past-day');
  expect(screen.today).toBe(false);
  expect(last).toMatchObject({ type: 'end', label: '結束' });
});

test('a day whose walk runs past midnight ends 「接續隔天」', async () => {
  const { screen, last } = await open('history-cross-midnight');
  expect(screen.today).toBe(false);
  expect(last.continuesNextDay).toBe(true);
  expect(nodePill(last)).toEqual({ text: '接續隔天', tone: 'plain' });
});

test('indoors until now: the list ends on the house node 「室內・N 分」', async () => {
  const { last } = await open('history-indoor-end');
  expect(last.type).toBe('indoor');
  expect(nodePill(last)).toEqual({ text: '室內・30 分', tone: 'indoor' });
});

test('a swipe over a row never counts as a tap on it (useTap)', async () => {
  const { useTap, TAP_SLOP } = require('../src/mapHistory/HistoryTimelineList');
  const pressed = jest.fn();
  let tap;
  function Row() {
    tap = useTap(pressed, 'stop');
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Row />); });
  const at = (x, y) => ({ nativeEvent: { pageX: x, pageY: y } });
  tap.onPressIn(at(100, 1700));
  tap.onPress(at(100, 900));
  expect(pressed).not.toHaveBeenCalled();
  tap.onPressIn(at(100, 1700));
  tap.onPress(at(100 + TAP_SLOP - 2, 1702));
  expect(pressed).toHaveBeenCalledWith('stop');
  // Accessibility and tests press without coordinates: a tap.
  tap.onPress(undefined);
  expect(pressed).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});
