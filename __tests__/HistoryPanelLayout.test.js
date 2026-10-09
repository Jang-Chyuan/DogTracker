import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HistoryPanel from '../src/mapHistory/HistoryPanel';
import MyRouteHeader from '../src/history/screen/MyRouteHeader';
import Glyph from '../src/map/Glyph';
import { mapPanelHeight, dogCardMaxHeight } from '../src/map/MapPanelHeight';
import { overlayFramePadding } from '../src/map/MapFraming';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import { size, space, border, fontWeight } from '../src/theme/tokens';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: jest.fn(() => ({ top: 24, bottom: 20, left: 0, right: 0 })),
}));

test.each([lightTheme, darkTheme])('my route is a header with a person glyph and themed halo ($isDark)', async theme => {
  let renderer;
  await act(async () => { renderer = Renderer.create(<ThemeScope theme={theme}><MyRouteHeader /></ThemeScope>); });
  const header = renderer.root.findByProps({ testID: 'history-my-route-header' });
  expect(header.props.accessibilityRole).toBe('header');
  expect(header.props.onPress).toBeUndefined();
  const rowStyle = StyleSheet.flatten(header.props.style);
  expect(rowStyle.backgroundColor).toBeUndefined();
  expect(rowStyle.borderRadius).toBeUndefined();
  expect(renderer.root.findByType(Glyph).props.name).toBe('person');
  expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'history-my-route-avatar' }).props.style))
    .toMatchObject({ width: 32, height: 32, borderWidth: border.strong,
      borderColor: theme.colors.phone, backgroundColor: theme.settingIcon.phone.bg });
  expect(StyleSheet.flatten(renderer.root.findByType(Text).props.style)).toMatchObject({
    fontWeight: fontWeight.medium, color: theme.colors.text, textShadowColor: theme.colors.mapLabelHalo,
    textShadowRadius: size.mapLabel.halo,
  });
  await act(async () => renderer.unmount());
});

test.each([1, 1.3, 2])('fixed history height and framing share the dog-card rule at font scale %s', async fontScale => {
  const spy = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 400, height: 800, scale: 1, fontScale,
  });
  const ref = React.createRef();
  const scrollRef = React.createRef();
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<HistoryPanel ref={ref} scrollRef={scrollRef} bottomInset={20}
      header={<Text>Header</Text>}><Text testID="last-node">End</Text></HistoryPanel>); });
    const panel = renderer.root.findByProps({ testID: 'history-panel' });
    const height = StyleSheet.flatten(panel.props.style).height;
    expect(height).toBe(mapPanelHeight(useWindowDimensions().height, useSafeAreaInsets().top));
    expect(height).toBe(dogCardMaxHeight(800, 24, 20) + space.s + 20);
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
  }
});
