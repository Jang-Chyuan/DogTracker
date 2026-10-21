import { t as i18nT } from '../src/i18n';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, Text, StyleSheet } from 'react-native';
import DogCard from '../src/map/DogCard';
import { dogCard, phoneReading } from '../src/map/DogCardModel';
import { dogCardReadings, readDogCardRows } from '../src/activity/DogCardReadings';
import { RANGE_STATUS } from '../src/tracking/ReceiverRange';
import { colors } from '../src/theme/tokens';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const NOW = new Date(2026, 9, 7, 9, 30, 0).getTime();
const HOME = { latitude: 24.9893, longitude: 121.3135 };
const model = (extra = {}, options = {}) => dogCard({ slaveId: 4, coordinate: { latitude: 24.9947, longitude: 121.3194 },
  fixAt: NOW - 5000, packetAt: NOW - 5000, batteryPercentage: 15, charging: false, ...extra }, {
  freshness: { stale: true, basis: 'position', source: 'ble', lastAt: new Date(2026, 9, 7, 9, 5).getTime() },
  range: { status: RANGE_STATUS.OUT, judgedAt: NOW, cloudOnly: false },
  phone: phoneReading({ running: true, position: { ...HOME, timestamp: NOW } }, NOW), now: NOW, name: '豆豆',
  ...options,
});

let renderer, onBack, removeBack;
beforeEach(() => {
  jest.useFakeTimers();
  removeBack = jest.fn();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    onBack = callback;
    return { remove: removeBack };
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const flatten = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  // The first row's off-screen measuring copy of its value is never seen.
  if (node.props?.importantForAccessibility === 'no-hide-descendants') return '';
  return flatten(node.children);
};
const byTestId = id => renderer.root.findAll(node => node.props.testID === id, { deep: true });

async function mount(props = {}) {
  const handlers = { onClosed: jest.fn(), onHeight: jest.fn(), onEdit: jest.fn(), onActivity: jest.fn(),
    onTrack: jest.fn() };
  const ref = React.createRef();
  await act(async () => {
    renderer = Renderer.create(<DogCard ref={ref} card={model()} {...handlers} {...props} />);
  });
  // The card rises once it knows its height.
  await act(async () => byTestId('dog-card')[0].props.onLayout({ nativeEvent: { layout: { height: 420 } } }));
  return { ...handlers, ref };
}

test('A3b on screen: name, three rows in order, the distance in the first, red and amber 「!」, no receiver row', async () => {
  const { onHeight } = await mount();
  // What it covers: its height and the 8dp it floats above the screen edge.
  expect(onHeight).toHaveBeenLastCalledWith(428);
  const text = flatten(renderer.toJSON());
  expect(text).toContain('豆豆');
  // 訊號源 is on the dog's edit sheet now, not on the card.
  expect(text).not.toContain('訊號源');
  // The distance sits at the first row's right end (no headline above).
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置09:05 之後沒有新位置850 m不在接收範圍');
  expect(text).not.toContain('離手機');
  const order = ['位置', '電量', '活動量'].map(label => text.indexOf(label));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(byTestId('dog-card-row-range')).toHaveLength(0);
  expect(text).not.toContain(i18nT('c075'));
  expect(text).toContain(i18nT('c071'));
  // Problem values: dark red bold behind a red 「!」; 快離開: amber behind an amber 「!」.
  const value = words => renderer.root.findAllByType(Text).find(node => flatten(node.props.children) === words
    && node.props.importantForAccessibility !== 'no-hide-descendants');
  expect(value('09:05 之後沒有新位置').props.style).toEqual(expect.arrayContaining([{ color: colors.crit }]));
  // The second problem, on the row's own line: red too, one 「!」 for both.
  expect(value(i18nT('c078')).props.style).toEqual(expect.arrayContaining([{ color: colors.crit }]));
  expect(byTestId('dog-card-row-position')[0].findAll(node => node.props.testID === 'dog-card-mark-crit'
    && node.props.background)).toHaveLength(1);
  // The 「!」 circles are vectors (060): red for problems, amber for 快離開.
  const all = renderer.root.findAll(node => /^dog-card-mark-/.test(node.props.testID ?? '') && node.props.background);
  expect(all.filter(node => node.props.background === colors.problemBadge).length).toBeGreaterThanOrEqual(2);
  // Rows have no fill (the design's correction): only the 「!」 is coloured.
  for (const id of ['position', 'battery', 'activity']) {
    const row = byTestId(`dog-card-row-${id}`)[0];
    const style = [row.props.style].flat(3).filter(Boolean);
    expect(style.some(item => item.backgroundColor)).toBe(false);
  }
  // 快離開 (a current dog): amber behind an amber 「!」, in the first row.
  await act(async () => renderer.update(<DogCard card={model({ batteryPercentage: 62 }, {
    freshness: { stale: false, basis: 'position', source: 'ble', lastAt: NOW },
    range: { status: RANGE_STATUS.NEAR, judgedAt: NOW, cloudOnly: false } })} />));
  expect(value(i18nT('c067')).props.style).toEqual(expect.arrayContaining([{ color: colors.warn }]));
  expect(renderer.root.findAll(node => node.props.testID === 'dog-card-mark-warn' && node.props.background
    === colors.warnIcon)).toHaveLength(1);
  expect(flatten(byTestId('dog-card-row-range')[0])).toBe(`接收範圍${i18nT('c067')}850 m`);
});

test('rows that are not buttons are 40dp (56dp with a second line); 活動量 stays 48dp', async () => {
  const { size: sizes, touch } = require('../src/theme/tokens');
  await mount();
  const minHeights = id => [byTestId(`dog-card-row-${id}`)[0].props.style].flat(3).filter(Boolean)
    .map(item => item.minHeight).filter(Boolean);
  expect(sizes.card.row).toBe(40);
  expect(sizes.card.rowTwoLine).toBe(56);
  expect(minHeights('battery').at(-1)).toBe(40);
  expect(minHeights('position').at(-1)).toBe(56);
  expect(minHeights('activity')).toEqual([touch.cardRow]);
});

// 2026-10-16: the distance always stays at the first line's right end, at
// every font; it went under the words at a large font or with a long value,
// which made the row (and, for every dog, the card) a line taller.
test('the distance stays at the first line\'s right end at every font; an old phone fix adds no line', async () => {
  const { PixelRatio } = require('react-native');
  const old = phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 3 * 60000 - 5000 } }, NOW);
  const scale = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  const distance = () => byTestId('dog-card-distance').find(node => typeof node.type === 'string');
  const besideFirstLine = () => {
    let host = distance().parent;
    while (host && typeof host.type !== 'string') host = host.parent;
    return StyleSheet.flatten(host.props.style)?.flexDirection === 'row'
      && StyleSheet.flatten(distance().props.style).alignItems === 'flex-end';
  };
  for (const fontScale of [1, 1.3, 2]) {
    scale.mockReturnValue(fontScale);
    await mount({ card: model({}, { phone: old }) });
    expect(flatten(distance())).toBe('850 m');
    expect(besideFirstLine()).toBe(true);
    // 2026-10-21 (user): the phone's fix being 3 minutes old is not written
    // (a stop held in low-power mode updates about every 30 s).
    expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置09:05 之後沒有新位置850 m不在接收範圍');
    expect(renderer.root.findAllByType(Text).some(node => /分鐘前/.test(flatten(node.props.children)))).toBe(false);
    // The value beside it wraps in its own column rather than pushing it down.
    const value = renderer.root.findAllByType(Text).find(node => flatten(node.props.children) === '09:05 之後沒有新位置');
    expect(value.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(value.props.style)).toMatchObject({ flex: 1, flexShrink: 1 });
    await act(async () => renderer.unmount());
    renderer = null;
  }
});

test('看軌跡 is 40dp drawn with a 48dp target; the rows sit 12dp under the top, behind a 1dp line', async () => {
  const { size: sizes, space, touch, border } = require('../src/theme/tokens');
  await mount();
  const track = byTestId('dog-card-track').find(node => node.props.hitSlop);
  const style = StyleSheet.flatten(track.props.style);
  expect(style.minHeight).toBe(sizes.card.track);
  expect(sizes.card.track).toBe(40);
  expect(style.minHeight + track.props.hitSlop.top + track.props.hitSlop.bottom).toBe(touch.min);
  let host = byTestId('dog-card-row-position')[0].parent;
  while (host && !(StyleSheet.flatten(host.props.style)?.borderTopWidth)) host = host.parent;
  expect(StyleSheet.flatten(host.props.style)).toMatchObject({ marginTop: space.m, borderTopWidth: border.hairline,
    borderTopColor: colors.line });
});

test('the address takes the row\'s whole width under the value and the distance, two lines at most', async () => {
  const { PixelRatio } = require('react-native');
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  const held = { heldReason: '室內', heldSource: 'weak' };
  const address = '330台灣桃園市桃園區武陵里中正路一段很長很長的巷弄 1 號附近';
  await mount({ card: model(held, { freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW },
    range: null, address }) });
  const line = renderer.root.findAllByType(Text).find(node => node.props.children === address);
  expect(line.props.numberOfLines).toBe(2);
  // Not on the first line: the value and the distance share only that one.
  let firstLine = byTestId('dog-card-distance').find(node => typeof node.type === 'string').parent;
  while (typeof firstLine.type !== 'string') firstLine = firstLine.parent;
  expect(StyleSheet.flatten(firstLine.props.style).flexDirection).toBe('row');
  expect(firstLine.findAll(node => node.props.children === address)).toHaveLength(0);
  expect(flatten(firstLine.children)).toBe('室內850 m');
});

test('two columns: left-aligned label with the 「!」 right after its text, the value column fixed', async () => {
  const { size: sizes, space } = require('../src/theme/tokens');
  const { PixelRatio } = require('react-native');
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  const rn = require('react-native');
  jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 360, height: 900, scale: 3.5, fontScale: 1 });
  await mount();
  // No lane any more.
  expect(renderer.root.findAll(node => node.props.testID === 'dog-card-mark-lane')).toHaveLength(0);
  const cells = renderer.root.findAll(node => node.props.testID === 'dog-card-label-cell' && typeof node.type === 'string');
  expect(cells).toHaveLength(3);
  for (const cell of cells) {
    // One width for every row: the longest label plus a 「!」.
    expect(StyleSheet.flatten(cell.props.style).width).toBe(sizes.card.labelWidth + sizes.card.markLane);
    expect(StyleSheet.flatten(cell.props.style).flexDirection).toBe('row');
  }
  // 位置 and 電量 have a 「!」, 活動量 not; the 「!」 follows the label, 4dp after.
  expect(cells.map(cell => cell.findAll(node => /^dog-card-mark-(crit|warn)$/.test(node.props.testID ?? '')
    && node.props.background).length)).toEqual([1, 1, 0]);
  for (const key of ['position', 'battery', 'activity']) {
    const row = jsonNode(renderer.toJSON(), node => node.props?.testID === `dog-card-row-${key}`);
    const cell = jsonNode(row, node => node.props?.testID === 'dog-card-label-cell');
    expect(flatten(cell.children[0])).toMatch(/^(位置|電量|活動量)$/);
    const text = jsonNode(cell, node => node.type === 'Text');
    expect(StyleSheet.flatten(text.props.style).textAlign).toBeUndefined();
    if (cell.children[1]) {
      expect(StyleSheet.flatten(cell.children[1].props.style).marginLeft).toBe(space.xs);
    }
  }
  // The address and the second problem stay in the value's column.
  const position = jsonNode(renderer.toJSON(), node => node.props?.testID === 'dog-card-row-position');
  const alert = jsonNode(position, node => node.type === 'Text' && flatten(node) === i18nT('c078'));
  expect(alert).toBeTruthy();
  // The label (with its 「!」) is centred against the whole value block: the
  // first line and the lines under it share one column beside it.
  for (const key of ['position', 'battery', 'activity']) {
    const row = jsonNode(renderer.toJSON(), node => node.props?.testID === `dog-card-row-${key}`);
    const head = jsonNode(row, node => Array.isArray(node.children)
      && node.children.some(child => child?.props?.testID === 'dog-card-label-cell'));
    expect(StyleSheet.flatten(head.props.style).alignItems).toBe('center');
    const cell = head.children[0];
    expect(StyleSheet.flatten(cell.props.style).alignSelf).toBe('center');
    expect(StyleSheet.flatten(cell.props.style).marginTop).toBeUndefined();
    expect(head.children).toHaveLength(2);
  }
  const column = jsonNode(position, node => Array.isArray(node.children)
    && node.children.includes(alert));
  expect(column).toBeTruthy();
  const first = jsonNode(position, node => node.type === 'Text' && flatten(node).startsWith('09:05'));
  expect(jsonNode(column, node => node === first)).toBe(first);
});

const jsonNode = (node, test) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(item => jsonNode(item, test)).find(Boolean) ?? null;
  if (test(node)) return node;
  return jsonNode(node.children, test);
};

test('label over value (a large font on a narrow phone): the label with its 「!」 on top, the value under it', async () => {
  const rn = require('react-native');
  jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 2 });
  await mount();
  const row = jsonNode(renderer.toJSON(), node => node.props?.testID === 'dog-card-row-position');
  const stack = row.children[0];
  const cell = stack.children[0];
  expect(cell.props.testID).toBe('dog-card-label-cell');
  expect(flatten(cell.children[0])).toBe('位置');
  expect(cell.children[1]).toBeTruthy();
  expect(StyleSheet.flatten(cell.props.style).flexDirection).toBe('row');
});

// 2026-10-14 (the card grew once after it had risen): it stays hidden until
// every dog's first row is measured and still, then rises at its final height
// and does not change after.
const reserveFor = () => {
  const other = dogCard({ slaveId: 6, coordinate: { latitude: 24.9947, longitude: 121.3194 }, fixAt: NOW - 5000,
    packetAt: NOW - 5000, batteryPercentage: 62, heldReason: '室內', heldSource: 'weak' }, {
    freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW }, now: NOW, name: '小黑',
    address: '桃園區中正路 1 號附近', phone: null });
  return [{ key: 6, row: other.rows[0], headline: other.headline }];
};
const layout = height => ({ nativeEvent: { layout: { height } } });
const rowsBox = () => renderer.root.findAll(node => typeof node.type === 'string'
  && StyleSheet.flatten(node.props.style)?.minHeight !== undefined
  && node.findAll(item => item.props.testID === 'dog-card-row-position').length > 0
  && StyleSheet.flatten(node.props.style)?.borderTopWidth)[0];
const measuredRows = () => {
  const measured = renderer.root.findAll(node => typeof node.type === 'string' && node.props.onLayout
    && !node.props.testID);
  const [rows, first] = measured.filter(node => node.findAll(item => item.props.testID === 'dog-card-row-position'
    && !findHidden(item)).length);
  return { rows, first, sample: measured.find(node => findHidden(node)) };
};

test('the card opens at its final height: hidden until every dog is measured, then never changes', async () => {
  const { onHeight } = await mount({ reserve: reserveFor() });
  // Laid out, but not shown yet: the other dogs are not measured.
  expect(onHeight).not.toHaveBeenCalled();
  const { rows, first, sample } = measuredRows();
  await act(async () => rows.props.onLayout(layout(160)));
  await act(async () => first.props.onLayout(layout(56)));
  // A size held for a moment only (a row before its distance settled) is
  // not the one it opens with.
  await act(async () => sample.props.onLayout(layout(120)));
  await act(async () => jest.advanceTimersByTime(16));
  await act(async () => sample.props.onLayout(layout(80)));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(160 - 56 + 80);
  // The card's own layout with that room, then it rises.
  await act(async () => byTestId('dog-card')[0].props.onLayout(layout(444)));
  await act(async () => jest.advanceTimersByTime(100));
  expect(onHeight.mock.calls).toEqual([[452]]);
  // After the rise: 小黑 shorter or taller, nothing changes.
  await act(async () => jest.advanceTimersByTime(1000));
  await act(async () => sample.props.onLayout(layout(40)));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(184);
  expect(onHeight.mock.calls).toEqual([[452]]);
  // The hidden rows are never read out.
  expect(renderer.root.findAll(node => node.props.importantForAccessibility === 'no-hide-descendants'
    && node.props.accessible === false).length).toBeGreaterThan(0);
});

test('measuring slower than 150 ms: it rises at the height it has and adds no room later', async () => {
  const { onHeight } = await mount({ reserve: reserveFor() });
  await act(async () => jest.advanceTimersByTime(200));
  expect(onHeight.mock.calls).toEqual([[428]]);
  const { rows, first, sample } = measuredRows();
  await act(async () => rows.props.onLayout(layout(160)));
  await act(async () => first.props.onLayout(layout(56)));
  await act(async () => sample.props.onLayout(layout(120)));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(0);
  expect(onHeight.mock.calls).toEqual([[428]]);
});

// 2026-10-16 (option B): the card is as tall as the tallest card among the
// dogs in the row, never changes while another dog of the row is picked, and
// is measured again (and may shrink) only when the dogs in the row change or
// the font size does.
test('picking another dog of the row keeps the height; a dog leaving the row measures it again', async () => {
  const { onHeight } = await mount({ reserve: reserveFor() });
  const { rows, first, sample } = measuredRows();
  await act(async () => rows.props.onLayout(layout(160)));
  await act(async () => first.props.onLayout(layout(56)));
  await act(async () => sample.props.onLayout(layout(100)));
  await act(async () => jest.advanceTimersByTime(100));
  await act(async () => byTestId('dog-card')[0].props.onLayout(layout(444)));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(160 - 56 + 100);
  const heights = onHeight.mock.calls.length;
  // Picking 小黑 (the tall one): its rows are the visible ones now, the open
  // dog's copy comes first in the row's list; nothing changes.
  const own = { key: 4, row: model().rows[0], headline: model().headline };
  await act(async () => renderer.update(<DogCard card={model({ slaveId: 6 })} reserve={[...reserveFor(), own]} />));
  await act(async () => first.props.onLayout(layout(100)));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(204);
  expect(onHeight.mock.calls).toHaveLength(heights);
  // 小黑 leaves the map: the row has only 豆豆, the room is its own.
  await act(async () => renderer.update(<DogCard card={model()} reserve={[]} />));
  await act(async () => first.props.onLayout(layout(56)));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(160);
});

test('a larger font measures the room again', async () => {
  const ReactNative = require('react-native');
  const window = ReactNative.Dimensions.get('window');
  const scale = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ ...window, fontScale: 1 });
  await mount({ reserve: reserveFor() });
  const { rows, first, sample } = measuredRows();
  await act(async () => rows.props.onLayout(layout(160)));
  await act(async () => first.props.onLayout(layout(56)));
  await act(async () => sample.props.onLayout(layout(100)));
  await act(async () => jest.advanceTimersByTime(100));
  await act(async () => byTestId('dog-card')[0].props.onLayout(layout(444)));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(204);
  // At 200% everything is measured again, here a shorter tallest row
  // (another phone's layout): the card takes the new height, not the old.
  scale.mockReturnValue({ ...window, fontScale: 2 });
  await act(async () => renderer.update(<DogCard card={model()} reserve={reserveFor()} />));
  const again = measuredRows();
  await act(async () => again.rows.props.onLayout(layout(150)));
  await act(async () => again.first.props.onLayout(layout(56)));
  await act(async () => again.sample.props.onLayout(layout(80)));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(150 - 56 + 80);
});

const findHidden = node => {
  for (let item = node; item; item = item.parent) {
    if (item.props?.importantForAccessibility === 'no-hide-descendants' && item.props?.pointerEvents === 'none') return true;
  }
  return false;
};

test('手機沒有定位 sits where the distance would', async () => {
  await mount({ card: model({}, { phone: null }) });
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe(`位置09:05 之後沒有新位置${i18nT('c726')}不在接收範圍`);
});

test('only 活動量, the pencil and 看軌跡 can be pressed; each reads out what it does', async () => {
  const { onEdit, onActivity, onTrack } = await mount();
  const pressables = renderer.root.findAll(node => typeof node.props.onPress === 'function'
    && node.props.accessibilityRole === 'button', { deep: false });
  expect(pressables.map(node => node.props.accessibilityLabel).sort())
    .toEqual(['活動量，沒有資料', i18nT('c071'), '編輯豆豆的名字和頭像'].sort());
  for (const node of pressables) await act(async () => node.props.onPress());
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onActivity).toHaveBeenCalledTimes(1);
  expect(onTrack).toHaveBeenCalledTimes(1);
  // The first row reads the distance with its words.
  expect(renderer.root.findAll(node => node.props.accessibilityRole === 'header')).toHaveLength(0);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel
    === '位置，09:05 之後沒有新位置，不在接收範圍，東北方 850 公尺，離手機')).not.toHaveLength(0);
});

test('the arrow points at the dog on the map as drawn (turned by the map heading)', async () => {
  await mount({ heading: 40 });
  const bearing = model().headline.bearing;
  const turn = byTestId('dog-card-arrow')[0].props.style.transform[0].rotate;
  expect(parseFloat(turn)).toBeCloseTo((bearing - 40 + 360) % 360, 3);
});

test('back closes it: it slides away, then reports closed and height 0', async () => {
  const { onClosed, onHeight } = await mount();
  expect(onBack()).toBe(true);
  expect(onClosed).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(400));
  expect(onClosed).toHaveBeenCalledTimes(1);
  expect(onHeight).toHaveBeenLastCalledWith(0);
});

test('close() (a tap on empty map) closes it too; the card itself takes the swipe', async () => {
  const { onClosed, ref } = await mount();
  await act(async () => ref.current.close());
  await act(async () => jest.advanceTimersByTime(400));
  expect(onClosed).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  await mount();
  const card = byTestId('dog-card')[0];
  // The pan handlers belong to the card itself (swipe down anywhere on it;
  // the swipe itself is checked on the emulator, frame by frame).
  expect(typeof card.props.onMoveShouldSetResponderCapture).toBe('function');
});

test('a held dog\'s 位置 row is 56dp high (A7b); the address line shows once known, no spinner before', async () => {
  const held = { heldReason: '室內', heldSource: 'weak' };
  const fresh = { freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW }, range: null };
  const heights = () => [byTestId('dog-card-row-position')[0].props.style].flat(3).filter(Boolean)
    .map(item => item.minHeight).filter(Boolean);
  await mount({ card: model(held, fresh) });
  // Still asking, none found or offline: 「室內」 alone, no spinner, one line.
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內850 m');
  expect(heights()).toContain(56);
  await act(async () => renderer.update(<DogCard card={model(held, { ...fresh, address: '桃園區中正路 1 號附近' })} />));
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內850 m桃園區中正路 1 號附近');
  expect(heights()).toContain(56);
});

test('held indoors: 位置 「室內」 (no minutes) and 活動量 「休息中・已 N 分鐘」', async () => {
  const held = { heldReason: '室內', heldSource: 'good', heldFrom: NOW - 26 * 60000 - 5000, packetAt: NOW - 5000 };
  const fresh = { freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW }, range: null };
  const rows = [];
  for (let time = NOW - 30 * 60000; time < NOW; time += 10000) {
    rows.push({ time, activity: time < NOW - 12 * 60000 ? 0.3 : 0.02, activity_valid: 1, slave_id: 4 });
  }
  const activity = dogCardReadings({ local: rows }, NOW).activity;
  await mount({ card: model(held, { ...fresh, activity, address: '桃園區中正路 1 號附近' }) });
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內850 m桃園區中正路 1 號附近');
  expect(flatten(byTestId('dog-card-row-activity')[0])).toContain('休息中・已 12 分鐘');
  const labels = renderer.root.findAll(node => typeof node.props.accessibilityLabel === 'string', { deep: true })
    .map(node => node.props.accessibilityLabel);
  expect(labels).toContain('位置，室內，桃園區中正路 1 號附近，東北方 850 公尺，離手機');
  expect(labels).toContain('活動量，休息中，活動量低已 12 分鐘');
});

test('the card\'s readings from SQLite: both tables, one copy per reading, the newest valid battery', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    const insert = (table, row) => {
      const keys = Object.keys(row);
      return connection.executeAsync(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        keys.map(key => row[key]));
    };
    for (let index = 0; index < 12; index += 1) {
      const time = NOW - (12 - index) * 60000 + 5000;
      await insert('dog_status', { received_at: time, slave_id: 4, master_id: 7, activity: '0.02', activity_valid: 1,
        battery_percentage: 60, battery_valid: index < 6 ? 1 : 0 });
      // This phone's upload, downloaded back: the same reading.
      await insert('supabase_dog_status', { owner_user_id: 'o', event_id: `e${index}`, received_at: time, track_at: time,
        slave_id: 4, master_id: 7, activity: '0.9', activity_valid: 1, battery_valid: 0 });
    }
    // Another dog and an invalid reading are not read.
    await insert('dog_status', { received_at: NOW - 30000, slave_id: 6, activity: '0.9', activity_valid: 1 });
    await insert('dog_status', { received_at: NOW - 40000, slave_id: 4, activity: '0.9', activity_valid: 0 });
    const rows = await readDogCardRows(connection, 'o', 4, NOW - 3600000);
    const readings = dogCardReadings(rows, NOW);
    // Same time to the millisecond and no collar stamp: one reading, the local one.
    expect(readings.activity.minutes).toHaveLength(12);
    expect(readings.activity.minutes.every(minute => minute.value === 0.02 && minute.count === 1)).toBe(true);
    expect(readings.battery).toEqual({ percentage: 60, charging: false, at: NOW - 7 * 60000 + 5000 });
    // Signed out: the local table only.
    const local = await readDogCardRows(connection, null, 4, NOW - 3600000);
    expect(local.cloud).toEqual([]);
    expect(await cloud.dogCardRows('o', 4, NOW - 3600000)).toEqual(rows);
    await expect(readDogCardRows(connection, 'o', 0, NOW)).rejects.toThrow();
  } finally {
    connection.close();
  }
});

// BatteryPlausibility on the card's own read: the SQL leaves out what can
// never be believed (0% without an empty cell, over 100%), the JS keeps the
// last believed reading through an unconfirmed sudden drop.
test('the card\'s battery read: a 0% blip and a lone drop keep the last believed reading', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    const insert = row => {
      const keys = Object.keys(row);
      return connection.executeAsync(`INSERT INTO dog_status(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        keys.map(key => row[key]));
    };
    const at = minutesAgo => NOW - minutesAgo * 60000;
    // Fictional collar: 43% (3800 mV), then a 0% packet with no voltage, one
    // with 255%, a lone 5% (3700 mV, a 38-point drop) and 0% at 4100 mV.
    await insert({ received_at: at(6), slave_id: 4, battery_percentage: 43, battery_mv: 3800, battery_valid: 1 });
    await insert({ received_at: at(5), slave_id: 4, battery_percentage: 0, battery_valid: 1 });
    await insert({ received_at: at(4), slave_id: 4, battery_percentage: 255, battery_valid: 1 });
    await insert({ received_at: at(3), slave_id: 4, battery_percentage: 5, battery_mv: 3700, battery_valid: 1 });
    await insert({ received_at: at(2), slave_id: 4, battery_percentage: 0, battery_mv: 4100, battery_valid: 1 });
    const rows = await readDogCardRows(connection, null, 4, NOW - 3600000);
    expect(rows.battery.map(row => row.battery_percentage)).toEqual([5, 43]);
    expect(dogCardReadings(rows, NOW).battery).toEqual({ percentage: 43, charging: false, at: at(6) });
    // A second agreeing packet confirms the drop.
    await insert({ received_at: at(1), slave_id: 4, battery_percentage: 4, battery_mv: 3690, battery_valid: 1 });
    expect(dogCardReadings(await readDogCardRows(connection, null, 4, NOW - 3600000), NOW).battery)
      .toEqual({ percentage: 4, charging: false, at: at(1) });
    // A real empty cell (0% at 3300 mV) is believed after a gradual drain.
    await insert({ received_at: at(0.5), slave_id: 4, battery_percentage: 0, battery_mv: 3300, battery_valid: 1 });
    expect(dogCardReadings(await readDogCardRows(connection, null, 4, NOW - 3600000), NOW).battery.percentage).toBe(0);
  } finally {
    connection.close();
  }
});

test('the card readings never show another reader\'s rows (logout, account or fixture switch)', async () => {
  const { useDogCardReadings } = require('../src/map/useDogCardReadings');
  const seen = [];
  function Probe({ read }) {
    seen.push(useDogCardReadings(read, 4, NOW));
    return null;
  }
  const rows = value => ({ local: [], cloud: [], battery: [{ time: NOW - 60000, battery_percentage: value, source: 'ble' }] });
  const first = jest.fn(async () => rows(50));
  let resolveSecond;
  const second = jest.fn(() => new Promise(resolve => { resolveSecond = resolve; }));
  await act(async () => { renderer = Renderer.create(<Probe read={first} />); });
  expect(seen.at(-1).battery.percentage).toBe(50);
  await act(async () => renderer.update(<Probe read={second} />));
  // The new reader has not answered yet: nothing, not the old account's 50%.
  expect(seen.at(-1)).toMatchObject({ loaded: false, battery: null });
  await act(async () => resolveSecond(rows(70)));
  expect(seen.at(-1).battery.percentage).toBe(70);
});

test('swiping back to a dog shows its readings at once (one draw), while they are read again', async () => {
  const { useDogCardReadings } = require('../src/map/useDogCardReadings');
  const seen = [];
  function Probe({ read, slaveId }) {
    seen.push({ slaveId, readings: useDogCardReadings(read, slaveId, NOW) });
    return null;
  }
  const rows = value => ({ local: [], cloud: [], battery: [{ time: NOW - 60000, battery_percentage: value, source: 'ble' }] });
  const pending = [];
  const read = jest.fn(slaveId => new Promise(resolve => pending.push(() => resolve(rows(slaveId * 10)))));
  await act(async () => { renderer = Renderer.create(<Probe read={read} slaveId={4} />); });
  await act(async () => pending.shift()());
  expect(seen.at(-1).readings.battery.percentage).toBe(40);
  await act(async () => renderer.update(<Probe read={read} slaveId={6} />));
  // A dog not read yet: nothing (never dog 4's).
  expect(seen.at(-1)).toMatchObject({ slaveId: 6, readings: { loaded: false } });
  await act(async () => pending.shift()());
  expect(seen.at(-1).readings.battery.percentage).toBe(60);
  // Back to dog 4: its last rows in the very first draw, read again behind.
  await act(async () => renderer.update(<Probe read={read} slaveId={4} />));
  const first = seen.findIndex(item => item.slaveId === 4 && seen.indexOf(item) > 2);
  expect(seen[first].readings.battery.percentage).toBe(40);
  expect(read).toHaveBeenCalledTimes(3);
});

test('E06: status labels reserve scaled width instead of wrapping at 1.3x', async () => {
  const rn = require('react-native');
  jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 390, height: 800, scale: 1, fontScale: 1.3 });
  await mount();
  const label = renderer.root.findAllByType(Text).find(node => node.props.children === '位置');
  const { size: sizes } = require('../src/theme/tokens');
  let cell = label.parent;
  while (cell && !rn.StyleSheet.flatten(cell.props.style)?.width) cell = cell.parent;
  expect(rn.StyleSheet.flatten(cell.props.style).width).toBe(sizes.card.labelWidth * 1.3 + sizes.card.markLane);
  jest.restoreAllMocks();
});


test.each([lightTheme, darkTheme])('normal and missing activity use distinct card text ($isDark)', async theme => {
  const card = model();
  const render = activityTone => <ThemeScope theme={theme}><DogCard card={{ ...card,
    rows: card.rows.map(row => row.key === 'activity' ? { ...row, activityTone, value: activityTone ? '一般' : '—' } : row),
  }} /></ThemeScope>;
  await act(async () => { renderer = Renderer.create(render('normal')); });
  const valueColor = () => {
    const row = renderer.root.findAll(node => node.props.testID === 'dog-card-row-activity')[0];
    return row.findAllByType(Text).map(node => StyleSheet.flatten(node.props.style)?.color);
  };
  expect(valueColor()).toContain(theme.colors.text);
  await act(async () => renderer.update(render(null)));
  expect(valueColor()).toContain(theme.colors.activityMissing);
  expect(valueColor()).not.toContain(theme.colors.activityLow);
});
