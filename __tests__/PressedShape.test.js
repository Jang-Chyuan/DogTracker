// The pressed state has the button's own shape (DESIGN.md §5.8, D18): round
// and pill buttons darken as a circle or a capsule, never a square grey box,
// and a floating pill keeps its own opaque fill under the overlay (§2.5).
// TouchTargets.test.js checks the same statically over every touchable.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { ThemeProvider, lightTheme } from '../src/theme/ThemeProvider';
import { radius } from '../src/theme/tokens';
import PressedOverlay from '../src/components/PressedOverlay';
import { PressScale } from '../src/map/MapControls';
import { TopRow } from '../src/mapHistory/HistoryScreen';

const flat = node => StyleSheet.flatten(node.props.style) || {};
// The Pressable itself (it draws through a children function).
const pressables = (tree, testID) => tree.root.findAll(node => typeof node.props.children === 'function'
  && typeof node.type !== 'string' && node.props.testID === testID);

// What a Pressable draws while held: its children called with pressed.
async function pressedTree(pressable) {
  let tree;
  await act(async () => {
    tree = Renderer.create(<ThemeProvider>{pressable.props.children({ pressed: true })}</ThemeProvider>);
  });
  return tree;
}

const overlayOf = tree => tree.root.findAll(node => node.props.testID === 'pressed-overlay'
  && typeof node.type === 'string');

test('PressedOverlay is pressedOverlay over the whole button, round unless told otherwise', async () => {
  let tree;
  await act(async () => { tree = Renderer.create(<ThemeProvider><PressedOverlay /></ThemeProvider>); });
  const [overlay] = overlayOf(tree);
  expect(flat(overlay)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: radius.full, backgroundColor: lightTheme.colors.pressedOverlay });
  expect(overlay.props.pointerEvents).toBe('none');
  await act(async () => tree.update(<ThemeProvider><PressedOverlay visible={false} /></ThemeProvider>));
  expect(overlayOf(tree)).toHaveLength(0);
});

test('PressScale lays its overlay in the corner of its own style, round when the style has none', async () => {
  let tree;
  await act(async () => {
    tree = Renderer.create(<ThemeProvider>
      <PressScale testID="card" accessibilityRole="button" style={{ borderRadius: 16 }}><Text>a</Text></PressScale>
      <PressScale testID="bare" accessibilityRole="button"><Text>b</Text></PressScale>
    </ThemeProvider>);
  });
  const corners = [];
  for (const id of ['card', 'bare']) for (const pressable of pressables(tree, id).slice(0, 1)) corners.push(flat(overlayOf(await pressedTree(pressable))[0]).borderRadius);
  expect(corners).toEqual([16, radius.full]);
});

test('history 「‹ 回到現在」 presses as its capsule, not a square box', async () => {
  let tree;
  await act(async () => {
    tree = Renderer.create(<ThemeProvider><TopRow top={0} subject="phone" dogs={[]} nameOf={() => ''}
      onBack={() => {}} onExport={() => {}} exportEnabled /></ThemeProvider>);
  });
  const back = pressables(tree, 'history-back-now').slice(0, 1);
  expect(back).toHaveLength(1);
  const held = await pressedTree(back[0]);
  // The shrinking view is the capsule itself (white, fully round) …
  const capsule = held.root.findAll(node => typeof node.type === 'string'
    && flat(node).backgroundColor === lightTheme.colors.surface);
  expect(capsule.map(node => flat(node).borderRadius)).toEqual([radius.full]);
  // … and the overlay inside it is round too.
  expect(overlayOf(held).map(node => flat(node).borderRadius)).toEqual([radius.full]);
  await act(async () => tree.unmount());
});

