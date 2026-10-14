// Switching dogs from the open card (DESIGN.md「摘要卡片」換狗, 2026-10-14):
// the card's top is a row of every dog on the map (DogCarousel), each once,
// in one stable order, with ends (no wrap-around); TalkBack's 下一隻／上一隻
// step through the same order.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, StyleSheet } from 'react-native';
import DogCard from '../src/map/DogCard';
import { BOUNCE, FLING_EXPONENT, FLING_VELOCITY, RUBBER, flingDistance, offsetOf, releaseTarget, releaseVelocity,
  rubberBand, slotAt, snapDuration } from '../src/map/DogCarousel';
import { dogCard } from '../src/map/DogCardModel';
import { switchOrder, switchTarget } from '../src/map/DogSwitch';
import { colors, size as sizes, touch } from '../src/theme/tokens';

const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 40,
  problem: false, selected: false, ...extra });

describe('the order', () => {
  const markers = [dog(12), dog(5), dog(8, { problem: true }), dog(4), dog(6, { selected: true }), dog(9)];

  test('every dog once, by signal-source number only: no problems first, the open dog in its own place', () => {
    expect(switchOrder(markers)).toEqual([4, 5, 6, 8, 9, 12]);
    expect(switchOrder([...markers].reverse())).toEqual([4, 5, 6, 8, 9, 12]);
    // A dog getting a problem, or gone, or new: the others never move.
    const now = [dog(4), dog(5, { problem: true }), dog(6), dog(9), dog(12), dog(3), dog(3)];
    expect(switchOrder(now)).toEqual([3, 4, 5, 6, 9, 12]);
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

  test('the row lands on the slot nearest its offset, never past an end', () => {
    const slot = sizes.card.carousel.slot;
    expect(offsetOf(0)).toBe(BOUNCE);
    expect(slotAt(offsetOf(0), 6)).toBe(0);
    expect(slotAt(offsetOf(0) + slot * 2.4, 6)).toBe(2);
    expect(slotAt(offsetOf(0) + slot * 2.6, 6)).toBe(3);
    // Pulled into the bounce's empty room past either end: the end dog.
    expect(BOUNCE).toBeGreaterThanOrEqual(slot / 2);
    expect(slotAt(0, 6)).toBe(0);
    expect(slotAt(offsetOf(5) + BOUNCE, 6)).toBe(5);
  });

  // 2026-10-14, the second phone try: a drag follows the finger, a fling goes
  // as far as its speed carries, a casual swipe one dog.
  // 2026-10-14, the fourth phone try: the glide is counted from where the
  // row is when let go, never from where the drag began.
  test('let go nearly still: the dog nearest where it was let go, however many cells away', () => {
    const slot = sizes.card.carousel.slot;
    expect(releaseTarget({ from: 1, x: offsetOf(1) + slot * 3.1, velocity: 0.1, count: 8 })).toBe(4);
    expect(releaseTarget({ from: 1, x: offsetOf(1) + slot * 0.4, velocity: -0.2, count: 8 })).toBe(1);
    expect(releaseTarget({ from: 1, x: offsetOf(1) + slot * 0.6, velocity: FLING_VELOCITY - 0.01, count: 8 })).toBe(2);
  });

  test('let go moving: it glides on from where it is by OverScroller physics, to the nearest dog; never back past the release', () => {
    const slot = sizes.card.carousel.slot;
    // Android's spline: distance grows with speed^1.74; 20dp at 1 dp/ms.
    expect(FLING_EXPONENT).toBeCloseTo(1.736, 3);
    expect(flingDistance(1)).toBeCloseTo(20, 6);
    expect(flingDistance(2) / flingDistance(1)).toBeCloseTo(2 ** FLING_EXPONENT, 6);
    expect(Math.round(flingDistance(4))).toBe(222);
    expect(flingDistance(FLING_VELOCITY - 0.01)).toBe(0);
    // A casual swipe (1 dp/ms) that carried the row 0.9 cells: one dog.
    expect(releaseTarget({ from: 3, x: offsetOf(3) + slot * 0.9, velocity: 1, count: 12 })).toBe(4);
    // A fast flick let go 3.4 cells on: it goes on from there, never back.
    expect(releaseTarget({ from: 3, x: offsetOf(3) + slot * 3.4, velocity: 1.5, count: 12 })).toBe(7);
    expect(releaseTarget({ from: 3, x: offsetOf(3) + slot * 3.4, velocity: 4, count: 12 })).toBe(10);
    // A short flick past the slop moves at least one dog.
    expect(releaseTarget({ from: 3, x: offsetOf(3) + slot * 0.1, velocity: 0.3, count: 12 })).toBe(4);
    expect(releaseTarget({ from: 3, x: offsetOf(3) - slot * 0.1, velocity: -0.3, count: 12 })).toBe(2);
    // A hard flick reaches the end, and never goes past it.
    expect(releaseTarget({ from: 2, x: offsetOf(2) + slot * 0.5, velocity: 5, count: 6 })).toBe(5);
    expect(releaseTarget({ from: 1, x: offsetOf(1) + slot * 0.5, velocity: 8, count: 12 })).toBe(11);
    expect(releaseTarget({ from: 3, x: offsetOf(3) - slot, velocity: -5, count: 6 })).toBe(0);
  });

  test('the release speed: the finger over its last 50 ms; a lift at the last move is not a stop, a pause is', () => {
    // Moving left 16dp every 8ms (2 dp/ms), lifted a frame later in place.
    const moves = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(step => ({ x: 400 - 16 * step, t: 1000 + 8 * step }));
    expect(releaseVelocity([...moves, { x: moves.at(-1).x, t: moves.at(-1).t + 8 }])).toBeCloseTo(2, 6);
    // Speeding up to the lift: the end speed, not the average.
    const flick = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(step => ({ x: 400 - step * step * 2, t: 1000 + 8 * step }));
    expect(releaseVelocity(flick)).toBeGreaterThan((flick[0].x - flick.at(-1).x) / (flick.at(-1).t - flick[0].t));
    // Held still 200 ms before lifting: no speed.
    expect(releaseVelocity([...moves, { x: moves.at(-1).x, t: moves.at(-1).t + 200 }])).toBe(0);
    expect(releaseVelocity([{ x: 100, t: 0 }])).toBe(0);
  });

  test('the slide starts at the release speed and slows to rest; past an end the row follows at half speed', () => {
    expect(snapDuration(64, 0.3)).toBe(640);
    expect(snapDuration(64, 1)).toBe(192);
    expect(snapDuration(64, 4)).toBe(180);
    expect(snapDuration(320, 1)).toBe(700);
    const low = offsetOf(0);
    expect(rubberBand(low - 40, 6)).toBe(low - 40 * RUBBER);
    expect(rubberBand(low - 1000, 6)).toBe(low - BOUNCE);
    expect(rubberBand(offsetOf(5) + 30, 6)).toBe(offsetOf(5) + 30 * RUBBER);
    expect(rubberBand(offsetOf(2), 6)).toBe(offsetOf(2));
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

  // A finger on the row: down at `x`, moved `dx` dp over `ms`, let go.
  const swipe = async (row, { dx, ms, x = 200, y = 100, steps = 8 }) => {
    const at = (step, t) => ({ nativeEvent: { pageX: x + (dx * step) / steps, pageY: y, timestamp: t } });
    await act(async () => row.props.onTouchStart(at(0, 1000)));
    const taken = row.props.onMoveShouldSetResponderCapture(at(1, 1000 + ms / steps));
    if (!taken) return false;
    await act(async () => row.props.onResponderGrant(at(1, 1000 + ms / steps)));
    for (let step = 2; step <= steps; step += 1) {
      await act(async () => row.props.onResponderMove(at(step, 1000 + (ms * step) / steps)));
    }
    await act(async () => row.props.onResponderRelease(at(steps, 1000 + ms)));
    await act(async () => jest.advanceTimersByTime(500));
    return true;
  };

  test('a drag follows the finger; a fling goes by its speed; a tap on a side face picks at once', async () => {
    const slot = sizes.card.carousel.slot;
    // 狗 12, 豆豆 (open), 阿福, 狗 15, 狗 16, 狗 17, 狗 18.
    const many = [...dogs, ...[15, 16, 17, 18].map(slaveId => ({ slaveId, name: `狗 ${slaveId}`, avatar: null,
      problem: false, stale: false }))];
    const value = switcher({ dogs: many });
    await mount({ switcher: value });
    const row = host('dog-card-carousel')[0];
    // Up and down is the card's (it closes the card), and a short move a tap.
    await act(async () => row.props.onTouchStart({ nativeEvent: { pageX: 200, pageY: 100, timestamp: 0 } }));
    expect(row.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 203, pageY: 140, timestamp: 50 } })).toBe(false);
    expect(row.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 205, pageY: 101, timestamp: 50 } })).toBe(false);
    // A slow drag three cells left (the finger stops before it lifts): three dogs on.
    expect(await swipe(row, { dx: -slot * 3, ms: 3000 })).toBe(true);
    expect(value.onSelect.mock.calls.at(-1)).toEqual([16]);
    // A casual swipe back (1.5 dp/ms) that carried the row one cell: it
    // glides 40dp on from there, to the nearest dog — two back from 狗 16.
    await swipe(row, { dx: slot, ms: slot / 1.5, steps: 4 });
    expect(value.onSelect.mock.calls.at(-1)).toEqual([8]);
    // A hard flick back (4 dp/ms): past the first, to 狗 12.
    await swipe(row, { dx: slot * 1.2, ms: (slot * 1.2) / 4 });
    expect(value.onSelect.mock.calls.at(-1)).toEqual([12]);
    // A tap on a side face picks it straight away.
    await act(async () => byTestId('dog-card-pick-8')[0].props.onPress());
    expect(value.onSelect.mock.calls.at(-1)).toEqual([8]);
  });

  test('the names grow, shrink and fade with their faces (the same position), and the row fits the tallest name', async () => {
    await mount({ switcher: switcher() });
    const names = renderer.root.findAll(node => node.props.children === '阿福' && Array.isArray(node.props.style)
      && node.props.style.some(item => item?.transform));
    expect(names.length).toBeGreaterThan(0);
    const face = renderer.root.findAll(node => Array.isArray(node.props.style)
      && node.props.style.some(item => item?.transform?.[0]?.scale) && node.findAll(item => item.props.children === '阿福').length === 0);
    const nameScale = names[0].props.style.find(item => item?.transform).transform[0].scale;
    // The same interpolation node as a face's scale.
    expect(face.some(node => node.props.style.find(item => item?.transform)?.transform[0].scale === nameScale)).toBe(true);
    // A hidden sample of every name sets the row's height.
    const samples = renderer.root.findAll(node => typeof node.type === 'string' && node.props.onLayout
      && ['狗 12', '豆豆', '阿福'].includes(node.props.children));
    expect(samples).toHaveLength(3);
  });

  test('pulled past an end, the row follows at half speed and, let go, slides back to the end dog', async () => {
    const value = switcher();
    await mount({ switcher: value });
    const row = host('dog-card-carousel')[0];
    const strip = () => row.findAll(node => typeof node.type === 'string' && node.props.style
      && StyleSheet.flatten(node.props.style)?.flexDirection === 'row')[0];
    // From 豆豆 (the middle) a slow drag far right: one dog back to 狗 12,
    // then the room past it, then back to 狗 12.
    await swipe(row, { dx: 400, ms: 4000 });
    expect(value.onSelect.mock.calls).toEqual([[12]]);
    expect(strip()).toBeTruthy();
    // The open dog on the card is still 豆豆 here (the switcher is a mock):
    // flinging toward the start from it, never past 狗 12.
    await swipe(row, { dx: 300, ms: 30 });
    expect(value.onSelect.mock.calls.at(-1)).toEqual([12]);
  });

  test('‹ › at the two ends move one dog, read as 上一隻／下一隻, and are gone at an end', async () => {
    const value = switcher();
    await mount({ switcher: value });
    const previous = byTestId('dog-card-step-previous');
    const next = byTestId('dog-card-step-next');
    expect(previous[0].props.accessibilityLabel).toBe('上一隻');
    expect(next[0].props.accessibilityLabel).toBe('下一隻');
    // 48dp targets.
    expect(StyleSheet.flatten(next[0].props.style({ pressed: false }))).toMatchObject({ width: touch.min, height: touch.min });
    await act(async () => next[0].props.onPress());
    expect(value.onSelect.mock.calls.at(-1)).toEqual([8]);
    // On the first dog: no ‹.
    await act(async () => renderer.update(<DogCard card={model(12, '狗 12')} switcher={value} />));
    expect(byTestId('dog-card-step-previous')).toHaveLength(0);
    expect(byTestId('dog-card-step-next')).toHaveLength(1);
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
