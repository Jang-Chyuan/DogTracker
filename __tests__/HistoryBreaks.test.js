// 067 (user 2026-10-09): what a break in a dog's history says.
// - At the same place before and after: one continuous stay (no row).
// - Packets without a fix, continuing a stay: folded into it (室內).
// - Packets without a fix while the dog walks on: 「收不到 GPS」.
// - No packet at all: 「沒收到訊號」. A phone's break stays 「沒有資料」.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { sectionText } from '../src/history/HistoryText';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { point } from '../__fixtures__/HistoryLogicFixtures';

const HOUR = 3600000;
const LEVELS = { summary: 140, half: 420, full: 620 };

function Harness({ fixture, onScreen }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `breaks:${fixture.name}:`,
    preset: fixture.historyView ?? null });
  onScreen(screen);
  return <HistoryScreen screen={screen} top={24} levels={LEVELS} bottomInset={0} name="小黑" history={null} />;
}

async function mountFixture(name) {
  const fixture = buildFixture(name);
  const state = { screen: null };
  await act(async () => {
    state.renderer = Renderer.create(<Harness fixture={fixture} onScreen={value => { state.screen = value; }} />);
  });
  await act(async () => {});
  state.text = () => JSON.stringify(state.renderer.toJSON());
  return state;
}

test('history-dog-breaks: the night at home is one stay, a stay without GPS is 室內, then 收不到 GPS and 沒收到訊號', async () => {
  const s = await mountFixture('history-dog-breaks');
  const nodes = s.screen.model.nodes;
  expect(nodes.map(n => n.type)).toEqual(['departure', 'stop', 'movement', 'stop', 'indoor', 'movement', 'gap',
    'movement', 'gap', 'movement', 'end']);
  // 5 h 40 min without a packet at home, inside the first stay.
  expect(nodes[1].durationMs).toBeGreaterThan(6 * HOUR);
  const gaps = nodes.filter(n => n.type === 'gap');
  expect(gaps.map(n => n.reason)).toEqual(['no-gps', 'no-signal']);
  expect(gaps.map(n => sectionText(n).lead)).toEqual(['收不到 GPS', '沒收到訊號']);
  const text = s.text();
  expect(text).toContain('收不到 GPS');
  expect(text).toContain('沒收到訊號');
  expect(text).not.toContain('沒有資料');
  await act(async () => s.renderer.unmount());
});

test('a phone\'s break that ends elsewhere still says 沒有資料', () => {
  const model = historyTimeline([point(0, 0, { accuracy: 5 }), point(10, 5, { accuracy: 5 }),
    point(1000, 400, { accuracy: 5 }), point(1010, 405, { accuracy: 5 })], { subject: 'phone' });
  const gap = model.nodes.find(n => n.type === 'gap');
  expect(gap.reason).toBeUndefined();
  expect(sectionText(gap).lead).toBe('沒有資料');
});
