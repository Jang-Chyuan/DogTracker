import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SettingIcon } from '../src/settings/SettingsUI';
import { MapTip } from '../src/map/MapControls';
import { CursorMarkerView, CursorFaceView } from '../src/mapHistory/HistoryMapMarkers';
import Skeleton from '../src/components/Skeleton';
import { radius } from '../src/theme/tokens';

const styles = renderer => renderer.root.findAll(n => n.props?.style && typeof n.props.style !== 'function').map(n => StyleSheet.flatten(n.props.style));

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('D18 settings icons, bottom hints and both cursor labels use the agreed shapes', async () => {
  let renderer;
  await act(async () => { renderer = Renderer.create(<>
    <SettingIcon kind="advanced" />
    <MapTip message={{ text: '手機沒有定位' }} bottom={16} />
    <CursorMarkerView lines={['10:20', '停留 10 分']} color="#123456" />
    <CursorFaceView lines={['10:20', '停留 10 分']} color="#123456" />
  </>); });
  const all = styles(renderer);
  expect(all).toContainEqual(expect.objectContaining({ width: 36, height: 36, borderRadius: radius.full }));
  expect(StyleSheet.flatten(renderer.root.findAllByProps({ testID: 'map-tip' })[0].props.style).borderRadius).toBe(radius.full);
  expect(all.filter(s => s.borderRadius === radius.cursorLabel && s.paddingVertical === 4 && s.paddingHorizontal === 10).length).toBeGreaterThanOrEqual(2);
  await act(async () => renderer.unmount());
});

test.each(['timeline', 'rows', 'chart', 'bars'])('D18 %s skeleton text is capsule shaped; A4 chart shapes stay square', async shape => {
  let renderer;
  await act(async () => { renderer = Renderer.create(<Skeleton shape={shape} reduced />); });
  const blocks = styles(renderer).filter(s => s.overflow === 'hidden');
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) expect(block.borderRadius).toBe(block.height > 16 ? 0 : radius.full);
  await act(async () => renderer.unmount());
});
