import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { nodePill } from '../src/history/HistoryText';

// The real pipeline, not hand-made nodes: a dog's endpoint is its last fix
// while the confirmed visit's coordinate is a mean, so equal coordinates
// alone never merged a dog's last stay into 現在／結束.
test.each([
  ['history-ends-in-stay', 'phone', '現在'],
  ['history-dog-ends-in-stay', 'dog', '現在'],
  ['history-ends-in-stay-finished', 'phone', '結束'],
  ['history-dog-ends-in-stay-finished', 'dog', '結束'],
])('%s: the last stay and the endpoint are one row', async (name, subject, label) => {
  const fixture = buildFixture(name);
  const target = historyTargetOf(fixture.history.preferences);
  const state = {};
  function Probe() {
    state.screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
      owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: 'ends-in-stay:',
      preset: fixture.historyView ?? null });
    return null;
  }
  let tree;
  await act(async () => { tree = Renderer.create(<Probe />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  try {
    expect(state.screen.subject).toBe(subject);
    const nodes = state.screen.model.nodes;
    const stay = nodes[nodes.length - 2], end = nodes[nodes.length - 1];
    expect(stay).toMatchObject({ type: 'stop' });
    expect(end).toMatchObject({ type: 'end', label });
    const shown = timelinePresentation(nodes);
    const last = shown[shown.length - 1];
    // One row: the end, starting when the stay started, carrying its minutes.
    expect(shown.filter(node => node.type === 'stop' && node.id === stay.id)).toHaveLength(0);
    expect(last).toMatchObject({ type: 'end', start: stay.start, end: end.start, label, terminalStay: stay, number: null });
    expect(nodePill(last).text).toMatch(new RegExp(`^${label} · 停`));
    // The endpoint keeps its own recorded place; the source nodes are untouched.
    expect(last.latitude).toBe(end.latitude);
    expect(nodes[nodes.length - 2]).toBe(stay);
  } finally { await act(async () => tree.unmount()); }
});
