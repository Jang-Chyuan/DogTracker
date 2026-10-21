import { t as i18nT } from '../src/i18n';
// 057a: how each day's time-line list ends (判定表「清單節點的內容」「「現在」」
// 「記錄被迫中止的終點膠囊」, past midnight), through useHistoryScreen as
// MapScreen drives it (recording from the phone's live state). 2026-10-15
// (user): never 「最後 HH:MM」.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { nodePill, summaryText } from '../src/history/HistoryText';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { timelineClockMismatches } from '../test-support/TimelineClocks';

function Harness({ fixture, onScreen }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `end:${fixture.name}:`,
    recordingStoppedAt: fixture.livePhone?.stoppedAt ?? null,
    recording: fixture.livePhone ? !!fixture.livePhone.running : null,
    recordingEnabled: typeof fixture.livePhone?.enabled === 'boolean' ? fixture.livePhone.enabled : null,
    interruptGraceMs: 0,
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

test('a dog without a fix for 17 minutes, following now: 「09:13 之後沒有位置」', async () => {
  const { last, screen } = await open('history-dog-stale');
  expect(last).toMatchObject({ type: 'end', endState: 'no-fix' });
  expect(nodePill(last)).toEqual({ text: '09:13 之後沒有位置', tone: 'plain' });
  expect(summaryText(screen.model, { subject: 'dog' }).title).toMatch(/ – 現在$/u);
});

// 2026-10-15 (user): my route following now, the fixes stopped.
test('standing still since 08:25, nothing saved since 08:50, recording on: the stay goes on to now, 「現在」', async () => {
  const { screen, fixture } = await open('history-recording-still');
  const shown = timelinePresentation(screen.model.nodes);
  const lastRow = shown.at(-1);
  // The stay is the last row (no end row after it) and runs to now.
  expect(lastRow.type).toBe('stop');
  expect(lastRow.end).toBe(fixture.now);
  expect(nodePill(lastRow).text).toBe('停 1 時 5 分');
  expect(screen.model.nodes.find(n => n.type === 'end')).toMatchObject({ endState: 'now', start: fixture.now });
  expect(summaryText(screen.model, { subject: 'phone' }).title).toMatch(/ – 現在$/u);
  expect(timelineClockMismatches(screen.model.nodes)).toEqual([]);
});

test('walking until 09:17, nothing since (a tunnel), recording on: 「09:17 之後沒有位置」', async () => {
  const { last, screen } = await open('history-recording-no-fix');
  expect(last).toMatchObject({ type: 'end', endState: 'no-fix' });
  expect(nodePill(last)).toEqual({ text: '09:17 之後沒有位置', tone: 'plain' });
  expect(summaryText(screen.model, { subject: 'phone' }).title).toMatch(/ – 現在$/u);
});

test('recording on but its service stopped (09:05): 「記錄中斷・09:05」 and the hint, not 「記錄已關閉」', async () => {
  const { last, screen } = await open('history-recording-interrupted');
  expect(last).toMatchObject({ type: 'end', endState: 'interrupted' });
  expect(nodePill(last)).toEqual({ text: '記錄中斷・09:05', tone: 'closed' });
  expect(screen.recordingEnd).toMatchObject({ reason: 'interrupted' });
  expect(i18nT('c1412', { time: '09:05' })).toBe('記錄在 09:05 中斷，重新打開 App 會繼續記錄');
});

test('only the end dragged back to 08:50: 「結束」 at that time, the start still 「出發」', async () => {
  const { last, screen } = await open('history-manual-end');
  // 2026-10-14: the start row has no 「出發」 capsule.
  expect(nodePill(screen.model.nodes[0])).toBeNull();
  expect(last).toMatchObject({ type: 'end', label: i18nT('c330') });
  expect(clock(last.end)).toBe('08:50');
});

test('K15: last fix 09:05, switched off at 09:30: 「記錄已關閉 09:30」, not 「結束」', async () => {
  const { last } = await open('history-recording-off');
  expect(last).toMatchObject({ type: 'end', label: i18nT("c656") });
  expect(clock(last.closedAt)).toBe('09:30');
  expect(nodePill(last)).toEqual({ text: '記錄已關閉 09:30', tone: 'closed' });
});

test('a past day this phone holds opens (preset goTo) and ends on 「結束」', async () => {
  const { screen, last } = await open('history-past-day');
  expect(screen.today).toBe(false);
  expect(last).toMatchObject({ type: 'end', label: i18nT('c330') });
});

// 2026-10-13 (approved): no 「接續隔天」 capsule on the end row.
test('a day whose walk runs past midnight ends without a capsule', async () => {
  const { screen, last } = await open('history-cross-midnight');
  expect(screen.today).toBe(false);
  expect(last.continuesNextDay).toBe(true);
  expect(nodePill(last)).toBeNull();
});

test('indoors until now: the list ends on the house node 「在遮蔽處 N 分」', async () => {
  const { last } = await open('history-indoor-end');
  expect(last.type).toBe('indoor');
  expect(nodePill(last)).toEqual({ text: '在遮蔽處 30 分', tone: 'indoor' });
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
