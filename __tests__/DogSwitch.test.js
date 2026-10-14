// Switching dogs from the open card (DESIGN.md「摘要卡片」換狗, 2026-10-14):
// the card's top is a row of every dog on the map (DogCarousel), each once,
// in one stable order, with ends (no wrap-around); TalkBack's 下一隻／上一隻
// step through the same order.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, StyleSheet } from 'react-native';
import DogCard from '../src/map/DogCard';
import { slotAt } from '../src/map/DogCarousel';
import { dogCard } from '../src/map/DogCardModel';
import { liveSwitchOrder, switchOrder, switchTarget } from '../src/map/DogSwitch';
import { colors, size as sizes, touch } from '../src/theme/tokens';

const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 40,
  problem: false, selected: false, ...extra });

describe('the order', () => {
  const markers = [dog(12), dog(5), dog(8, { problem: true }), dog(4), dog(6, { selected: true }), dog(9)];

  test('every dog, the opening one first, then problems, then by signal-source number', () => {
    // 6 was the open dog before; 4 opens now and comes first instead.
    expect(switchOrder(markers, 4)).toEqual([4, 8, 5, 6, 9, 12]);
    expect(switchOrder([...markers].reverse(), 4)).toEqual([4, 8, 5, 6, 9, 12]);
    // However the card was opened (a dog, a 「N 隻」 tag, a notification).
    expect(switchOrder(markers, 9)).toEqual([9, 8, 4, 5, 6, 12]);
  });

  test('a plain list with ends: no wrap-around, nothing past the first or the last', () => {
    const order = [4, 8, 5, 6];
    expect(switchTarget(order, 4, 1)).toBe(8);
    expect(switchTarget(order, 5, -1)).toBe(8);
    expect(switchTarget(order, 6, 1)).toBeNull();
    expect(switchTarget(order, 4, -1)).toBeNull();
    expect(switchTarget([4], 4, 1)).toBeNull();
    expect(switchTarget(order, 4, 0)).toBeNull();
    expect(switchTarget(order, 7, 1)).toBeNull();
  });

  test('kept while stepping: a dog gone drops out, a new dog comes last, a new problem does not jump the queue', () => {
    const taken = switchOrder(markers, 4);
    const now = [dog(4), dog(5, { problem: true }), dog(6), dog(8), dog(9), dog(12), dog(3)];
    expect(liveSwitchOrder(taken, now)).toEqual([4, 8, 5, 6, 9, 12, 3]);
    expect(liveSwitchOrder(taken, now.filter(item => item.slaveId !== 8))).toEqual([4, 5, 6, 9, 12, 3]);
  });

  test('the row lands on the slot nearest its offset, never past an end', () => {
    const slot = sizes.card.carousel.slot;
    expect(slotAt(0, 6)).toBe(0);
    expect(slotAt(slot * 2.4, 6)).toBe(2);
    expect(slotAt(slot * 2.6, 6)).toBe(3);
    // The platform's overscroll at either end lands on the end dog.
    expect(slotAt(-40, 6)).toBe(0);
    expect(slotAt(slot * 9, 6)).toBe(5);
  });
});

describe('the card', () => {
  const NOW = new Date(2026, 9, 7, 9, 30, 0).getTime();
  const model = (slaveId = 4, name = '豆豆') => dogCard({ slaveId, coordinate: { latitude: 24.9947, longitude: 121.3194 },
    fixAt: NOW - 5000, packetAt: NOW - 5000, batteryPercentage: 62, charging: false }, {
    freshness: { stale: false, basis: 'position', source: 'ble', lastAt: NOW - 5000 }, range: null, phone: null,
    now: NOW, name,
  });
  const dogs = [
    { slaveId: 12, name: '狗 12', avatar: null, problem: false, stale: false },
    { slaveId: 4, name: '豆豆', avatar: null, problem: false, stale: false },
    { slaveId: 8, name: '阿福', avatar: null, problem: true, stale: false },
  ];
  const switcher = (extra = {}) => ({ dogs, previous: 12, next: 8, onSelect: jest.fn(), onStep: jest.fn(), ...extra });
  let renderer;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const byTestId = id => renderer.root.findAll(node => node.props.testID === id && typeof node.props.onPress === 'function');
  const host = id => renderer.root.findAll(node => node.props.testID === id && typeof node.type === 'string');
  const words = () => JSON.stringify(renderer.toJSON());
  async function mount(props) {
    const handlers = { onClosed: jest.fn(), onHeight: jest.fn(), onEdit: jest.fn(), onActivity: jest.fn(), onTrack: jest.fn() };
    await act(async () => {
      renderer = Renderer.create(<DogCard card={model()} {...handlers} {...props} />);
    });
    await act(async () => renderer.root.findAll(node => node.props.testID === 'dog-card')[0]
      .props.onLayout({ nativeEvent: { layout: { height: 420 } } }));
    return handlers;
  }

  test('a lone dog: its face (the edit button, a pencil badge) and name; no row, no 訊號源', async () => {
    const { onEdit } = await mount({ switcher: null });
    expect(host('dog-card-carousel')).toHaveLength(0);
    const edit = byTestId('dog-card-edit');
    expect(edit).toHaveLength(1);
    expect(edit[0].props.accessibilityLabel).toBe('編輯豆豆的名字和頭像');
    expect(StyleSheet.flatten(edit[0].props.style({ pressed: false }))).toMatchObject({ width: touch.min, height: touch.min });
    expect(host('dog-card-edit-badge')).toHaveLength(1);
    expect(words()).toContain('豆豆');
    expect(words()).not.toContain('訊號源');
    await act(async () => edit[0].props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test('other dogs: the row has every dog once; the middle one is the edit button with the badge', async () => {
    const { onEdit } = await mount({ switcher: switcher() });
    expect(host('dog-card-carousel')).toHaveLength(1);
    const edit = byTestId('dog-card-edit');
    expect(edit).toHaveLength(1);
    expect(edit[0].props.accessibilityLabel).toBe('編輯豆豆的名字和頭像');
    expect(byTestId('dog-card-pick-12')[0].props.accessibilityLabel).toBe('換到狗 12');
    expect(byTestId('dog-card-pick-8')[0].props.accessibilityLabel).toBe('換到阿福');
    // Each dog exactly once (no copies for a loop).
    expect(renderer.root.findAll(node => /^dog-card-(pick-\d+|edit)$/.test(node.props.testID ?? '')
      && typeof node.props.onPress === 'function')).toHaveLength(3);
    expect(words()).not.toContain('訊號源');
    // The problem dog keeps its red 「!」 (outside the faded part).
    const red = renderer.root.findAll(node => node.props.background === colors.problemBadge);
    expect(red.length).toBeGreaterThan(0);
    await act(async () => edit[0].props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test('the user\'s drag lands on a dog: it is picked; the row\'s own moves pick nothing; a side tap picks at once', async () => {
    const value = switcher();
    await mount({ switcher: value });
    const row = host('dog-card-carousel')[0];
    const slot = sizes.card.carousel.slot;
    // The row placing itself on the open dog (no drag): nothing picked.
    await act(async () => row.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(value.onSelect).not.toHaveBeenCalled();
    await act(async () => row.props.onScrollBeginDrag());
    await act(async () => row.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 2 * slot } } }));
    expect(value.onSelect.mock.calls).toEqual([[8]]);
    await act(async () => row.props.onScrollBeginDrag());
    await act(async () => row.props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: slot * 1.2 }, velocity: { x: 0 } } }));
    expect(value.onSelect.mock.calls).toEqual([[8]]);
    // A fling's drag end waits for its momentum end.
    await act(async () => row.props.onScrollBeginDrag());
    await act(async () => row.props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 0 }, velocity: { x: 2 } } }));
    expect(value.onSelect.mock.calls).toEqual([[8]]);
    await act(async () => row.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(value.onSelect.mock.calls).toEqual([[8], [12]]);
    // A tap on a side face picks it straight away.
    await act(async () => byTestId('dog-card-pick-8')[0].props.onPress());
    expect(value.onSelect.mock.calls).toEqual([[8], [12], [8]]);
  });

  test('TalkBack: 下一隻／上一隻 on the middle face, only where there is a dog that way', async () => {
    const value = switcher();
    await mount({ switcher: value });
    const edit = () => byTestId('dog-card-edit')[0];
    expect(edit().props.accessibilityActions).toEqual([{ name: 'next', label: '下一隻' }, { name: 'previous', label: '上一隻' }]);
    await act(async () => edit().props.onAccessibilityAction({ nativeEvent: { actionName: 'next' } }));
    await act(async () => edit().props.onAccessibilityAction({ nativeEvent: { actionName: 'previous' } }));
    expect(value.onStep.mock.calls).toEqual([[1], [-1]]);
    // At the last dog: no 下一隻.
    await act(async () => renderer.update(<DogCard card={model(8, '阿福')} onEdit={jest.fn()}
      switcher={switcher({ previous: 4, next: null })} />));
    expect(edit().props.accessibilityActions).toEqual([{ name: 'previous', label: '上一隻' }]);
  });

  test('another dog picked: the body fades in and TalkBack hears its name; no second announcement', async () => {
    const announce = jest.spyOn(require('react-native').AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    announce.mockClear();
    const handlers = await mount({ switcher: switcher() });
    expect(announce).not.toHaveBeenCalled();
    await act(async () => renderer.update(<DogCard card={model(8, '阿福')} {...handlers} switcher={switcher()} />));
    await act(async () => renderer.update(<DogCard card={model(8, '阿福')} {...handlers} switcher={switcher()} />));
    expect(announce.mock.calls).toEqual([['阿福']]);
  });
});
