import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text } from 'react-native';
import HistoryPanel from '../src/mapHistory/HistoryPanel';
import MyRouteHeader from '../src/history/screen/MyRouteHeader';
import Glyph from '../src/map/Glyph';
import { historyPanelMaxHeight } from '../src/map/MapPanelHeight';
import { withAlpha } from '../src/history/screen/HistoryMapModel';
import { overlayFramePadding } from '../src/map/MapFraming';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import { space, border, fontWeight, radius } from '../src/theme/tokens';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: jest.fn(() => ({ top: 24, bottom: 20, left: 0, right: 0 })),
}));

test.each([lightTheme, darkTheme])('my route is a header with a person glyph and themed translucent backing ($isDark)', async theme => {
  let renderer;
  await act(async () => { renderer = Renderer.create(<ThemeScope theme={theme}><MyRouteHeader /></ThemeScope>); });
  const header = renderer.root.findByProps({ testID: 'history-my-route-header' });
  expect(header.props.accessibilityRole).toBe('header');
  expect(header.props.onPress).toBeUndefined();
  const rowStyle = StyleSheet.flatten(header.props.style);
  expect(rowStyle.backgroundColor).toBe(withAlpha(theme.colors.surface, theme.opacity.mapHeaderBacking));
  expect(rowStyle.borderRadius).toBe(radius.full);
  expect(rowStyle.shadowColor).toBeUndefined();
  expect(rowStyle.elevation).toBeUndefined();
  expect(rowStyle.borderWidth).toBeUndefined();
  expect(renderer.root.findByType(Glyph).props.name).toBe('person');
  expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'history-my-route-avatar' }).props.style))
    .toMatchObject({ width: 32, height: 32, borderWidth: border.strong,
      borderColor: theme.colors.phone, backgroundColor: theme.settingIcon.phone.bg });
  expect(StyleSheet.flatten(renderer.root.findByType(Text).props.style)).toMatchObject({
    fontWeight: fontWeight.medium, color: theme.colors.text,
  });
  await act(async () => renderer.unmount());
});

test.each([1, 1.3, 1.7999, 2])('fixed height and framing agree at font scale %s', async fontScale => {
  const spy = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 400, height: 800, scale: 1, fontScale,
  });
  const onHeightChange = jest.fn();
  const ref = React.createRef();
  const scrollRef = React.createRef();
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<HistoryPanel ref={ref} scrollRef={scrollRef} bottomInset={20} onHeightChange={onHeightChange}
      header={<Text accessibilityRole="header">Date and time range</Text>}><Text testID="last-node">End</Text></HistoryPanel>); });
    const panel = renderer.root.findByProps({ testID: 'history-panel' });
    const height = StyleSheet.flatten(panel.props.style).height;
    expect(height).toBe(388);
    expect(onHeightChange).toHaveBeenLastCalledWith(height);
    expect(ref.current.back()).toBe(false);
    expect(panel.props.onMoveShouldSetResponder).toBeUndefined();
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props.contentContainerStyle.paddingBottom).toBe(20 + (fontScale >= 1.79 ? space.s : space.l));
    expect(scroll.props.nestedScrollEnabled).toBe(true);
    expect(scroll.props.scrollEnabled).not.toBe(false);
    expect(scroll.findByProps({ testID: 'last-node' })).toBeTruthy();
    expect(scroll.findAllByProps({ testID: 'history-panel-header' })).toHaveLength(0);
    const header = renderer.root.findByProps({ testID: 'history-panel-header' });
    expect(StyleSheet.flatten(header.props.style).flexShrink).toBe(0);
    expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(header.findByProps({ accessibilityRole: 'header' })).toBeTruthy();
    scrollRef.current.scrollTo({ y: 240, animated: false });
    expect(scrollTo).toHaveBeenCalledWith({ y: 240, animated: false });
    expect(overlayFramePadding({ top: 24, bottom: 0, left: 24, right: 24 }, {
      bottomInset: 0, overlayBottom: height,
    }).bottom).toBe(height);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    spy.mockRestore();
    scrollTo.mockRestore();
  }
});

test('short/long/empty days, phone/dog and expanded header all keep the same fixed height', async () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 400, height: 800, scale: 1, fontScale: 2,
  });
  const onHeightChange = jest.fn();
  let renderer;
  const render = (day, subject, count, headerHeight) => <HistoryPanel measureKey={`${day}:${subject}`}
    onHeightChange={onHeightChange} header={<Text style={{ height: headerHeight }}>Date and time range</Text>}>
    {Array.from({ length: count }, (_, index) => <Text key={index}>Timeline row {index}</Text>)}
    <Text testID="last-node">{count ? 'Last timeline node' : 'No data'}</Text>
  </HistoryPanel>;
  try {
    await act(async () => { renderer = Renderer.create(render('day-one', 'phone', 1, 60)); });
    for (const props of [['day-two', 'dog', 120, 300], ['day-three', 'phone', 0, 60], ['day-four', 'dog', 2, 180]]) {
      await act(async () => renderer.update(render(...props)));
      expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'history-panel' }).props.style).height).toBe(388);
      expect(renderer.root.findByType(ScrollView).findByProps({ testID: 'last-node' })).toBeTruthy();
    }
    expect(onHeightChange).toHaveBeenCalledTimes(1);
    // Content/header layout cannot reopen the retired adaptive-height path.
    expect(renderer.root.findByProps({ testID: 'history-panel-content' }).props.onLayout).toBeUndefined();
    expect(renderer.root.findByProps({ testID: 'history-panel-header' }).props.onLayout).toBeUndefined();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    dimensions.mockRestore();
  }
});

test('only window/top inset changes update fixed height; font and bottom padding do not', async () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions');
  const safeArea = require('react-native-safe-area-context').useSafeAreaInsets;
  dimensions.mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 1 });
  const onHeightChange = jest.fn();
  const render = bottomInset => <HistoryPanel bottomInset={bottomInset} onHeightChange={onHeightChange}
    header={<Text>Header</Text>}><Text>Timeline</Text></HistoryPanel>;
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(render(20)); });
    expect(onHeightChange).toHaveBeenLastCalledWith(388);
    dimensions.mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 2 });
    await act(async () => renderer.update(render(40)));
    expect(onHeightChange).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType(ScrollView).props.contentContainerStyle.paddingBottom).toBe(40 + space.s);
    dimensions.mockReturnValue({ width: 800, height: 500, scale: 1, fontScale: 2 });
    await act(async () => renderer.update(render(40)));
    expect(onHeightChange).toHaveBeenLastCalledWith(historyPanelMaxHeight(500, 24));
    safeArea.mockReturnValue({ top: 40, bottom: 20, left: 0, right: 0 });
    await act(async () => renderer.update(render(40)));
    expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'history-panel' }).props.style).height).toBe(230);
    expect(onHeightChange).toHaveBeenLastCalledWith(230);
    expect(onHeightChange).toHaveBeenCalledTimes(3);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    dimensions.mockRestore();
    safeArea.mockReturnValue({ top: 24, bottom: 20, left: 0, right: 0 });
  }
});


test.each([
  { width: 851, height: 393, fontScale: 2, gap: 0 },
  { width: 851, height: 393, fontScale: 1.3, gap: space.l },
  { width: 393, height: 851, fontScale: 2, gap: space.s },
  { width: 1024, height: 768, fontScale: 2, gap: space.s },
])('very large short-wide text keeps nav inset but omits optional tail space: %j', async viewport => {
  const spy = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ ...viewport, scale: 2.75 });
  let tree;
  try {
    await act(async () => { tree = Renderer.create(<HistoryPanel bottomInset={24} header={<Text>Fixed header</Text>}><Text testID="last-node">Complete END text</Text></HistoryPanel>); });
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll.props.contentContainerStyle.paddingBottom).toBe(24 + viewport.gap);
    expect(StyleSheet.flatten(tree.root.findByProps({ testID: 'history-panel' }).props.style).height)
      .toBe(historyPanelMaxHeight(viewport.height, 24));
    expect(scroll.findByProps({ testID: 'last-node' })).toBeTruthy();
    expect(scroll.findAllByProps({ testID: 'history-panel-header' })).toHaveLength(0);
    // Independent native sizing counterexample: settled list284px, nav66px,
    // full END row216px at2.75scale. This arithmetic is not native Yoga proof.
    if (viewport.gap === 0) {
      const listHeight = 284 / 2.75;
      const navigationHeight = 66 / 2.75;
      const endRowHeight = 216 / 2.75;
      const padding = scroll.props.contentContainerStyle.paddingBottom;
      expect(padding).toBeGreaterThanOrEqual(navigationHeight);
      expect(listHeight - padding).toBeGreaterThanOrEqual(endRowHeight);
      expect(listHeight - navigationHeight - space.s).toBeLessThan(endRowHeight);
    }
  } finally {
    if (tree) await act(async () => tree.unmount());
    spy.mockRestore();
  }
});
