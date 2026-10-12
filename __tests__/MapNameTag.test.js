import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, PixelRatio } from 'react-native';
import { CursorFaceView, CursorMarkerView, cursorAnchor } from '../src/mapHistory/HistoryMapMarkers';
import MapNameTag from '../src/map/MapNameTag';
import { markerFrame, MARKER_WIDTH } from '../src/map/DogMarkerView';
import { tagSize } from '../src/map/DogMarkers';
import { size, radius } from '../src/theme/tokens';

test('single-line names are capsules; measured wrapping uses 12dp and can return to one line', () => {
  let renderer;
  act(() => {
    renderer = Renderer.create(
      <MapNameTag text="小黑・室內" maxWidth={MARKER_WIDTH - 8} />,
    );
  });
  const tag = () =>
    renderer.root
      .findAllByProps({ testID: 'dog-name-tag' })
      .find(node => typeof node.type === 'string');
  const style = () => StyleSheet.flatten(tag().props.style);
  expect(style()).toMatchObject({
    borderRadius: radius.full,
    paddingHorizontal: 8,
  });
  const text = renderer.root.findByType(Text);
  act(() => text.props.onTextLayout({ nativeEvent: { lines: [{}, {}] } }));
  expect(style().borderRadius).toBe(12);
  act(() => text.props.onTextLayout({ nativeEvent: { lines: [{}] } }));
  expect(style().borderRadius).toBe(radius.full);
});

test('padding is included in collision sizing and the bitmap frame preserves text width', () => {
  expect(tagSize('小黑').width).toBe(26 + 2 * (8 + 1));
  expect(
    MARKER_WIDTH - 8 - 2 * (size.mapLabel.paddingH + size.mapLabel.border),
  ).toBe(148);
  const scale = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
  const frame = markerFrame(56);
  expect(frame.height).toBeGreaterThanOrEqual(8 + 56 + 2 + 64 + 6);
  expect(frame.anchor.y * frame.height).toBeCloseTo(36);
  scale.mockRestore();
});

test('multi-dog history cursor names use the capsule token', () => {
  let renderer;
  act(() => {
    renderer = Renderer.create(
      <CursorFaceView
        lines={['10:20', '移動中']}
        color="#123456"
        face={{ name: '小黑' }}
      />,
    );
  });
  const name = renderer.root
    .findAllByType(Text)
    .find(node => node.props.children === '小黑');
  expect(StyleSheet.flatten(name.parent.props.style)).toMatchObject({
    borderRadius: size.mapLabel.radius,
    paddingHorizontal: size.mapLabel.paddingH,
  });
});

// Hidden bitmap labels retain their layout; removing the block would shift the dot's anchor.
test.each([CursorMarkerView, CursorFaceView])('cursor label replacement preserves its measured anchor block (%s)', Component => {
  let renderer;
  const onLabelHeight = jest.fn();
  const props = { lines: ['09:10', '移動中'], color: '#123456', face: { name: '虛構狗' }, onLabelHeight };
  act(() => { renderer = Renderer.create(<Component {...props} />); });
  const label = () => renderer.root.findAll(node => typeof node.type === 'string' && typeof node.props.onLayout === 'function')[0];
  const originalStyle = StyleSheet.flatten(label().props.style);
  const anchor = cursorAnchor(44, Component === CursorFaceView);
  act(() => renderer.update(<Component {...props} labelHidden />));
  expect(StyleSheet.flatten(label().props.style)).toEqual({ ...originalStyle, opacity: 0 });
  expect(label().props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
  act(() => label().props.onLayout({ nativeEvent: { layout: { height: 44 } } }));
  expect(onLabelHeight).toHaveBeenCalledWith(44);
  expect(cursorAnchor(44, Component === CursorFaceView)).toEqual(anchor);
  act(() => renderer.update(<Component {...props} />));
  expect(StyleSheet.flatten(label().props.style)).toEqual(originalStyle);
  act(() => renderer.unmount());
});
