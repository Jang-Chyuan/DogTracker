import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';

// React Native logs 「Text strings must be rendered within a <Text>
// component」 for any string (even JSX indentation) left directly in a View.
// The test renderer does not, so walk the rendered history screen for one.
test.each(['history-my-route', 'history-multi-dog', 'history-past-day'])('no text outside a Text: %s', async name => {
  const fixture = buildFixture(name);
  const target = historyTargetOf(fixture.history.preferences);
  function Probe() {
    const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
      owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: 'raw-text:',
      preset: fixture.historyView ?? null, historyCloud: fixture.historyCloud });
    return <HistoryScreen screen={screen} top={24} bottomInset={0} />;
  }
  let tree;
  await act(async () => { tree = Renderer.create(<Probe />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  const loose = [];
  const walk = (node, inText, path) => {
    if (typeof node === 'string') { if (!inText) loose.push({ text: node, path }); return; }
    if (!node) return;
    const label = node.props?.testID ? `${node.type}#${node.props.testID}` : node.type;
    (node.children || []).forEach(child => walk(child, inText || node.type === 'Text', [...path, label].slice(-4)));
  };
  [].concat(tree.toJSON()).forEach(node => walk(node, false, []));
  expect(loose).toEqual([]);
  expect(tree.root.findAll(node => node.props.testID?.startsWith?.('timeline-movement')).length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});
