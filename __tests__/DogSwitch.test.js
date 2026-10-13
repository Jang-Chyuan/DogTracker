// Switching dogs from the open card (DESIGN.md「摘要卡片」換狗, 2026-10-13
// option B): ‹ › in the grab handle's row, a sideways swipe, TalkBack's
// 下一隻／上一隻; every dog on the map, in one stable order.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, PanResponder, StyleSheet } from 'react-native';
import DogCard from '../src/map/DogCard';
import { dogCard } from '../src/map/DogCardModel';
import {
  SWIPE_DISTANCE,
  SWIPE_MIN_FLING,
  SWIPE_SLOP,
  isSwitchSwipe,
  liveSwitchOrder,
  swipeStep,
  switchOrder,
  switchTarget,
} from '../src/map/DogSwitch';
import { colors, touch } from '../src/theme/tokens';

const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 40,
  problem: false, selected: false, ...extra });

describe('the order', () => {
  const markers = [dog(12), dog(5), dog(8, { problem: true }), dog(4), dog(6, { selected: true }), dog(9)];

  test('every dog, the opening one first, then problems, then by signal-source number', () => {
    // 6 was the open dog before; 4 opens now and comes first instead.
    expect(switchOrder(markers, 4)).toEqual([4, 8, 5, 6, 9, 12]);
    expect(switchOrder([...markers].reverse(), 4)).toEqual([4, 8, 5, 6, 9, 12]);
    // However the card was opened (a dog, a 「N 隻」 tag, a notification):
    // all of them, no group first.
    expect(switchOrder(markers, 9)).toEqual([9, 8, 4, 5, 6, 12]);
  });

  test('steps wrap around both ways; one dog has nothing to switch to', () => {
    const order = [4, 8, 5, 6];
    expect(switchTarget(order, 4, 1)).toBe(8);
    expect(switchTarget(order, 6, 1)).toBe(4);
    expect(switchTarget(order, 4, -1)).toBe(6);
    expect(switchTarget(order, 5, -1)).toBe(8);
    expect(switchTarget([4], 4, 1)).toBeNull();
    expect(switchTarget(order, 4, 0)).toBeNull();
    // A dog not in the order (just drawn): next is the first, previous the last.
    expect(switchTarget(order, 7, 1)).toBe(4);
    expect(switchTarget(order, 7, -1)).toBe(6);
  });

  test('kept while stepping: a dog gone drops out, a new dog comes last, a new problem does not jump the queue', () => {
    const taken = switchOrder(markers, 4);
    const now = [dog(4), dog(5, { problem: true }), dog(6), dog(8), dog(9), dog(12), dog(3)];
    expect(liveSwitchOrder(taken, now)).toEqual([4, 8, 5, 6, 9, 12, 3]);
    expect(liveSwitchOrder(taken, now.filter(item => item.slaveId !== 8))).toEqual([4, 5, 6, 9, 12, 3]);
  });
});

describe('the swipe', () => {
  test('only a clearly sideways drag is a switch: past the slop and 1.5× more across than down', () => {
    expect(isSwitchSwipe({ dx: SWIPE_SLOP, dy: 0 })).toBe(false);
    expect(isSwitchSwipe({ dx: -(SWIPE_SLOP + 1), dy: 0 })).toBe(true);
    expect(isSwitchSwipe({ dx: 40, dy: 20 })).toBe(true);
    // A slanted pull-down stays the card's close gesture.
    expect(isSwitchSwipe({ dx: 30, dy: 25 })).toBe(false);
    expect(isSwitchSwipe({ dx: 10, dy: 60 })).toBe(false);
  });

  test('released far enough, or flung, it steps (left = next); a short slow drag springs back', () => {
    expect(swipeStep({ dx: -SWIPE_DISTANCE, vx: 0 })).toBe(1);
    expect(swipeStep({ dx: SWIPE_DISTANCE, vx: 0 })).toBe(-1);
    expect(swipeStep({ dx: -(SWIPE_DISTANCE - 1), vx: -0.1 })).toBe(0);
    expect(swipeStep({ dx: -SWIPE_MIN_FLING, vx: -0.6 })).toBe(1);
    expect(swipeStep({ dx: SWIPE_MIN_FLING, vx: 0.6 })).toBe(-1);
    // Too short to be a fling, or flung back the other way.
    expect(swipeStep({ dx: -(SWIPE_MIN_FLING - 1), vx: -2 })).toBe(0);
    expect(swipeStep({ dx: -40, vx: 0.8 })).toBe(0);
  });
});

describe('the card', () => {
  const NOW = new Date(2026, 9, 7, 9, 30, 0).getTime();
  const model = (slaveId = 4, name = '豆豆') => dogCard({ slaveId, coordinate: { latitude: 24.9947, longitude: 121.3194 },
    fixAt: NOW - 5000, packetAt: NOW - 5000, batteryPercentage: 62, charging: false }, {
    freshness: { stale: false, basis: 'position', source: 'ble', lastAt: NOW - 5000 }, range: null, phone: null,
    now: NOW, name,
  });
  let renderer, pan;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
    const create = PanResponder.create.bind(PanResponder);
    jest.spyOn(PanResponder, 'create').mockImplementation(config => {
      pan = config;
      return create(config);
    });
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const byTestId = id => renderer.root.findAll(node => node.props.testID === id && typeof node.props.onPress === 'function');
  const identity = () => renderer.root.find(node => node.props.testID === 'dog-card-identity' && node.props.accessible);
  async function mount(props) {
    const handlers = { onClosed: jest.fn(), onHeight: jest.fn(), onEdit: jest.fn(), onActivity: jest.fn(), onTrack: jest.fn() };
    await act(async () => {
      renderer = Renderer.create(<DogCard card={model()} {...handlers} {...props} />);
    });
    await act(async () => renderer.root.findAll(node => node.props.testID === 'dog-card')[0]
      .props.onLayout({ nativeEvent: { layout: { height: 420 } } }));
    return handlers;
  }
  const switcher = (extra = {}) => ({ previous: '狗 12', next: '阿福', onStep: jest.fn(), ...extra });

  test('a lone dog: no ‹ ›, no actions, no swipe; the face still opens A5', async () => {
    await mount({ switcher: null });
    expect(byTestId('dog-card-next')).toHaveLength(0);
    expect(byTestId('dog-card-previous')).toHaveLength(0);
    expect(identity().props.accessibilityLabel).toBe('豆豆，訊號源 4');
    expect(identity().props.accessibilityActions).toBeUndefined();
    expect(pan.onMoveShouldSetPanResponderCapture(null, { dx: -120, dy: 0 })).toBe(false);
    expect(byTestId('dog-card-edit')).toHaveLength(1);
  });

  test('the face is the edit button: 48dp, a neutral pencil badge, TalkBack says what it does', async () => {
    const { onEdit } = await mount({ switcher: switcher() });
    const edit = byTestId('dog-card-edit')[0];
    expect(edit.props.accessibilityRole).toBe('button');
    expect(edit.props.accessibilityLabel).toBe('編輯豆豆的名字和頭像');
    const style = StyleSheet.flatten(edit.props.style({ pressed: false }));
    expect(style).toMatchObject({ width: touch.min, height: touch.min });
    // The face and the badge are inside it; the badge is not a status mark
    // (no red, no 「!」): surface with a thin line, a pencil.
    expect(edit.findAll(node => node.props.testID === 'dog-card-edit-badge' && typeof node.type === 'string')).toHaveLength(1);
    const badge = StyleSheet.flatten(edit.find(node => node.props.testID === 'dog-card-edit-badge'
      && typeof node.type === 'string').props.style);
    expect(badge).toMatchObject({ backgroundColor: colors.surface, borderColor: colors.line });
    expect(edit.findAll(node => node.props.name === 'pencil')).toHaveLength(1);
    // Only one edit control on the card (no separate pencil).
    expect(renderer.root.findAll(node => node.props.name === 'pencil')).toHaveLength(1);
    await act(async () => edit.props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test('「‹（頭像✏️）名字 ›」: 48dp labelled ‹ › around the face and name, 看軌跡 untouched', async () => {
    const value = switcher();
    await mount({ switcher: value });
    const next = byTestId('dog-card-next')[0];
    const previous = byTestId('dog-card-previous')[0];
    expect(next.props.accessibilityRole).toBe('button');
    expect(next.props.accessibilityLabel).toBe('下一隻：阿福');
    expect(previous.props.accessibilityLabel).toBe('上一隻：狗 12');
    const size = node => StyleSheet.flatten(typeof node.props.style === 'function'
      ? node.props.style({ pressed: false }) : node.props.style);
    expect(size(next)).toMatchObject({ width: touch.min, height: touch.min });
    expect(touch.min).toBe(48);
    // The title row, in order: ‹, the face (the edit button) and the name, ›.
    const header = renderer.root.findAll(node => typeof node.type === 'string'
      && node.findAll(child => child.props.testID === 'dog-card-next').length > 0
      && node.findAll(child => child.props.testID === 'dog-card-previous').length > 0
      && node.findAll(child => child.props.testID === 'dog-card-edit').length > 0
      && node.findAll(child => child.props.testID === 'dog-card-track').length === 0).pop();
    const ids = header.findAll(child => /^dog-card-(previous|edit|identity|next)$/.test(child.props.testID ?? '')
      && typeof child.type === 'string').map(child => child.props.testID);
    expect([...new Set(ids)]).toEqual(['dog-card-previous', 'dog-card-edit', 'dog-card-identity', 'dog-card-next']);
    await act(async () => next.props.onPress());
    await act(async () => previous.props.onPress());
    expect(value.onStep.mock.calls).toEqual([[1], [-1]]);
  });

  test('TalkBack: the name carries 下一隻／上一隻 and no place in the order', async () => {
    const value = switcher();
    await mount({ switcher: value });
    expect(identity().props.accessibilityLabel).toBe('豆豆，訊號源 4');
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/第 \d+ 隻|共 \d+ 隻|\d+ \/ \d+/);
    expect(identity().props.accessibilityActions).toEqual([
      { name: 'next', label: '下一隻' }, { name: 'previous', label: '上一隻' }]);
    await act(async () => identity().props.onAccessibilityAction({ nativeEvent: { actionName: 'next' } }));
    await act(async () => identity().props.onAccessibilityAction({ nativeEvent: { actionName: 'previous' } }));
    expect(value.onStep.mock.calls).toEqual([[1], [-1]]);
  });

  test('a new dog on the same card is announced once', async () => {
    const announce = jest.spyOn(require('react-native').AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    const handlers = await mount({ switcher: switcher() });
    expect(announce).not.toHaveBeenCalled();
    await act(async () => renderer.update(<DogCard card={model(8, '阿福')} {...handlers}
      switcher={switcher({ previous: '豆豆', next: '狗 5' })} />));
    await act(async () => renderer.update(<DogCard card={model(8, '阿福')} {...handlers}
      switcher={switcher({ previous: '豆豆', next: '狗 5' })} />));
    expect(announce.mock.calls).toEqual([['阿福，訊號源 8']]);
  });

  test('a sideways swipe steps; a pull-down still closes; neither fights the other', async () => {
    const value = switcher();
    const { onHeight } = await mount({ switcher: value });
    // Sideways: next when the finger goes left, previous to the right.
    expect(pan.onMoveShouldSetPanResponderCapture(null, { dx: -30, dy: 4 })).toBe(true);
    pan.onPanResponderMove(null, { dx: -90, dy: 6 });
    await act(async () => pan.onPanResponderRelease(null, { dx: -90, dy: 6, vx: -0.2, vy: 0 }));
    expect(pan.onMoveShouldSetPanResponderCapture(null, { dx: 30, dy: 4 })).toBe(true);
    await act(async () => pan.onPanResponderRelease(null, { dx: 30, dy: 4, vx: 0.9, vy: 0 }));
    // Too short and slow: springs back, no step.
    expect(pan.onMoveShouldSetPanResponderCapture(null, { dx: -30, dy: 0 })).toBe(true);
    await act(async () => pan.onPanResponderRelease(null, { dx: -40, dy: 0, vx: -0.1, vy: 0 }));
    expect(value.onStep.mock.calls).toEqual([[1], [-1]]);
    // A slanted drag is neither; a downward one is the close, never a step.
    expect(pan.onMoveShouldSetPanResponderCapture(null, { dx: 20, dy: 18 })).toBe(false);
    expect(pan.onMoveShouldSetPanResponderCapture(null, { dx: 10, dy: 40 })).toBe(true);
    await act(async () => pan.onPanResponderRelease(null, { dx: 10, dy: 300, vx: 0, vy: 1 }));
    expect(value.onStep).toHaveBeenCalledTimes(2);
    expect(onHeight).toHaveBeenLastCalledWith(0);
  });
});
