import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { nodePill } from '../src/history/HistoryText';
import { historyMapPresentation } from '../src/history/screen/HistoryMapModel';

// The real pipeline, not hand-made nodes. 2026-10-14 (user, replaces merging
// the last stay into 現在／結束): a range that ends in a stay ends with that
// stay — a numbered row of its own — and no end row; the map draws no end
// time marker there (the stay's number marks it).
test.each([
  ['history-ends-in-stay', 'phone', '現在'],
  ['history-dog-ends-in-stay', 'dog', '現在'],
  ['history-ends-in-stay-finished', 'phone', '結束'],
  ['history-dog-ends-in-stay-finished', 'dog', '結束'],
])('%s: the last stay is the last row, numbered; no end row', async (name, subject, label) => {
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
    // The model keeps its end node (the summary's 「– 現在」, CSV, GPX).
    expect(end).toMatchObject({ type: 'end', label });
    const shown = timelinePresentation(nodes);
    const last = shown[shown.length - 1];
    expect(shown.some(node => node.type === 'end' || node.terminalStay)).toBe(false);
    expect(last).toMatchObject({ type: 'stop', id: stay.id, number: stay.number });
    expect(stay.number).toBeGreaterThan(0);
    expect(nodePill(last).text).toMatch(/^停 /u);
    // No 「結束」 anywhere in the list.
    expect(shown.some(node => nodePill(node)?.text?.includes('結束'))).toBe(false);
    // The map: no end time marker on that stay; its number is there.
    const map = historyMapPresentation(state.screen.model, { color: '#1A73E8', subject });
    expect(map.times.some(marker => marker.last)).toBe(false);
    expect(map.places.some(place => (place.numbers ?? [place.number]).includes(stay.number))).toBe(true);
    expect(nodes[nodes.length - 2]).toBe(stay);
  } finally { await act(async () => tree.unmount()); }
});
