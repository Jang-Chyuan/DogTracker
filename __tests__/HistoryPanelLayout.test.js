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

test.each([1, 1.3, 2])('content height and framing share the settled panel height at font scale %s', async fontScale => {
  const spy = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 400, height: 800, scale: 1, fontScale,
  });
  jest.useFakeTimers();
  const onHeightChange = jest.fn();
  const ref = React.createRef();
  const scrollRef = React.createRef();
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<HistoryPanel ref={ref} scrollRef={scrollRef} bottomInset={20} onHeightChange={onHeightChange}
      header={<Text>Header</Text>}><Text testID="last-node">End</Text></HistoryPanel>); });
    const panel = renderer.root.findByProps({ testID: 'history-panel' });
    const content = renderer.root.findByProps({ testID: 'history-panel-content' });
    await act(async () => {
      content.props.onLayout({ nativeEvent: { layout: { height: 260 * fontScale } } });
      jest.runAllTimers();
    });
    const height = StyleSheet.flatten(panel.props.style).height;
    expect(height).toBe(Math.min(388, 260 * fontScale + 20 + space.l));
    expect(height).toBeLessThanOrEqual(388);
    expect(onHeightChange).toHaveBeenLastCalledWith(height);
    expect(ref.current).toEqual({ back: expect.any(Function) });
    expect(ref.current.back()).toBe(false);
    expect(panel.props.onMoveShouldSetResponder).toBeUndefined();
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props.contentContainerStyle.paddingBottom).toBe(20 + space.l);
    expect(scroll.findByProps({ testID: 'last-node' })).toBeTruthy();
    const header = scroll.findByProps({ testID: 'history-panel-header' });
    header.props.onLayout({ nativeEvent: { layout: { height: 160 } } });
    scrollRef.current.scrollTo({ y: 240, animated: false });
    expect(scrollTo).toHaveBeenCalledWith({ y: 400, animated: false });
    const padding = overlayFramePadding({ top: 24, bottom: 0, left: 24, right: 24 }, {
      bottomInset: 0, overlayBottom: height,
    });
    expect(padding.bottom).toBe(height);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    spy.mockRestore();
    scrollTo.mockRestore();
    jest.useRealTimers();
  }
});


test('long content caps, ignores scroll/layout refreshes, and remeasures a new day', async () => {
  jest.useFakeTimers();
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 400, height: 800, scale: 1, fontScale: 2,
  });
  const onHeightChange = jest.fn();
  let renderer;
  const render = day => <HistoryPanel measureKey={day} onHeightChange={onHeightChange}
    header={<Text>Header</Text>}><Text>Timeline end</Text></HistoryPanel>;
  const measure = async height => act(async () => {
    renderer.root.findByProps({ testID: 'history-panel-content' }).props.onLayout({ nativeEvent: { layout: { height } } });
    jest.runAllTimers();
  });
  try {
    await act(async () => { renderer = Renderer.create(render('day-one')); });
    await measure(2000);
    const cap = StyleSheet.flatten(renderer.root.findByProps({ testID: 'history-panel' }).props.style).height;
    expect(cap).toBe(historyPanelMaxHeight(800, 24));
    expect(cap).toBe(388);
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props.scrollEnabled).not.toBe(false);
    expect(scroll.props.nestedScrollEnabled).toBe(true);
    await act(async () => { scroll.props.onScroll?.({ nativeEvent: { contentOffset: { y: 1000 } } }); });
    await measure(100);
    expect(onHeightChange).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'history-panel' }).props.style).height).toBe(cap);
    await act(async () => renderer.update(render('day-two')));
    await measure(300);
    expect(onHeightChange).toHaveBeenLastCalledWith(300 + space.l);
    expect(onHeightChange).toHaveBeenCalledTimes(2);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    dimensions.mockRestore();
    jest.useRealTimers();
  }
});
