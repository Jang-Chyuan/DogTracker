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
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置沒有新位置・最後 09:05不在接收範圍850 m');
  expect(text).not.toContain('離手機');
  const order = ['位置', '電量', '活動量'].map(label => text.indexOf(label));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(byTestId('dog-card-row-range')).toHaveLength(0);
  expect(text).not.toContain(i18nT('c075'));
  expect(text).toContain(i18nT('c071'));
  // Problem values: dark red bold behind a red 「!」; 快離開: amber behind an amber 「!」.
  const value = words => renderer.root.findAllByType(Text).find(node => flatten(node.props.children) === words
    && node.props.importantForAccessibility !== 'no-hide-descendants');
  expect(value('沒有新位置・最後 09:05').props.style).toEqual(expect.arrayContaining([{ color: colors.crit }]));
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

test('at a large font the distance goes under the first row\'s words; an old phone fix says so under it', async () => {
  const { PixelRatio } = require('react-native');
  const old = phoneReading({ running: true, position: { ...HOME, timestamp: NOW - 3 * 60000 - 5000 } }, NOW);
  const scale = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  await mount({ card: model({}, { phone: old }) });
  const distance = () => byTestId('dog-card-distance').find(node => typeof node.type === 'string');
  // Beside the first line (on its line, at its right end), or under the words.
  const inWords = () => StyleSheet.flatten(distance().props.style).alignItems === 'flex-start';
  const besideFirstLine = () => {
    let host = distance().parent;
    while (host && typeof host.type !== 'string') host = host.parent;
    return StyleSheet.flatten(host.props.style)?.flexDirection === 'row';
  };
  expect(flatten(distance())).toBe('850 m手機位置 3 分鐘前');
  expect(inWords()).toBe(false);
  expect(besideFirstLine()).toBe(true);
  await act(async () => renderer.unmount());
  scale.mockReturnValue(2);
  await mount({ card: model({}, { phone: old }) });
  expect(inWords()).toBe(true);
  expect(besideFirstLine()).toBe(false);
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

test('the distance stays beside the first line only while the value fits there on one line', async () => {
  const { PixelRatio } = require('react-native');
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  await mount();
  const distance = () => byTestId('dog-card-distance').find(node => typeof node.type === 'string');
  const under = () => StyleSheet.flatten(distance().props.style).alignItems === 'flex-start';
  const sample = renderer.root.findAll(node => node.props.importantForAccessibility === 'no-hide-descendants'
    && node.props.onTextLayout)[0];
  const firstLine = renderer.root.findAll(node => typeof node.type === 'string' && node.props.onLayout
    && StyleSheet.flatten(node.props.style)?.flexDirection === 'row'
    && node.findAll(item => item.props.testID === 'dog-card-distance').length > 0)[0];
  // Not measured yet: beside (the normal font).
  expect(under()).toBe(false);
  const layout = async ({ value, room, width = 70 }) => {
    await act(async () => sample.props.onTextLayout({ nativeEvent: { lines: [{ width: value }] } }));
    await act(async () => firstLine.props.onLayout({ nativeEvent: { layout: { width: room } } }));
    await act(async () => distance().props.onLayout({ nativeEvent: { layout: { width } } }));
  };
  // A 360dp phone: 「沒有新位置・最後 09:05」 (about 175dp) and 「↗ 1.4 km」
  // (70dp) do not fit in 214dp: the distance goes under, the value stays one line.
  await layout({ value: 175, room: 214 });
  expect(under()).toBe(true);
  // Room for both: beside again.
  await layout({ value: 175, room: 300 });
  expect(under()).toBe(false);
});

test('the 「!」 sits in front of the label, not in the value column (no width or height taken)', async () => {
  await mount();
  const marks = renderer.root.findAll(node => /^dog-card-mark-/.test(node.props.testID ?? '') && node.props.background);
  expect(marks.length).toBeGreaterThanOrEqual(2);
  for (const mark of marks) {
    let cell = mark.parent;
    while (cell && !(cell.findAll(node => node.props.children === '位置' || node.props.children === '電量').length)) {
      cell = cell.parent;
    }
    // Its own wrapper is out of the flow (absolute), inside the label cell.
    let wrapper = mark.parent;
    while (wrapper && StyleSheet.flatten(wrapper.props.style)?.position !== 'absolute') wrapper = wrapper.parent;
    expect(StyleSheet.flatten(wrapper.props.style)).toMatchObject({ position: 'absolute' });
    expect(StyleSheet.flatten(wrapper.props.style).left).toBeLessThan(0);
    const value = wrapper.parent.parent.findAll(node => node.props.testID === 'dog-card-distance');
    expect(value).toHaveLength(0);
  }
});

test('the card keeps room for the tallest first row among the other dogs, and never gives it back while open', async () => {
  const other = dogCard({ slaveId: 6, coordinate: { latitude: 24.9947, longitude: 121.3194 }, fixAt: NOW - 5000,
    packetAt: NOW - 5000, batteryPercentage: 62, heldReason: '室內', heldSource: 'weak' }, {
    freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW }, now: NOW, name: '小黑',
    address: '桃園區中正路 1 號附近', phone: null });
  const reserve = [{ key: 6, row: other.rows[0], headline: other.headline }];
  await mount({ reserve });
  const layout = height => ({ nativeEvent: { layout: { height } } });
  const rowsBox = () => renderer.root.findAll(node => typeof node.type === 'string'
    && StyleSheet.flatten(node.props.style)?.minHeight !== undefined
    && node.findAll(item => item.props.testID === 'dog-card-row-position').length > 0
    && StyleSheet.flatten(node.props.style)?.borderTopWidth)[0];
  const measured = renderer.root.findAll(node => typeof node.type === 'string' && node.props.onLayout
    && !node.props.testID);
  // The rows (all three), this dog's first row, and 小黑's (hidden) first row.
  const [rows, first] = measured.filter(node => node.findAll(item => item.props.testID === 'dog-card-row-position'
    && !findHidden(item)).length);
  const sample = measured.find(node => findHidden(node));
  await act(async () => rows.props.onLayout(layout(160)));
  await act(async () => first.props.onLayout(layout(56)));
  // A height held for a moment only is not kept (a row before its distance
  // settled); one that holds still for 300 ms is.
  await act(async () => sample.props.onLayout(layout(120)));
  await act(async () => jest.advanceTimersByTime(100));
  await act(async () => sample.props.onLayout(layout(80)));
  await act(async () => jest.advanceTimersByTime(400));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(160 - 56 + 80);
  // 小黑 back to one line: the room stays.
  await act(async () => sample.props.onLayout(layout(40)));
  expect(StyleSheet.flatten(rowsBox().props.style).minHeight).toBe(184);
  // The hidden rows are never read out.
  expect(renderer.root.findAll(node => node.props.importantForAccessibility === 'no-hide-descendants'
    && node.props.accessible === false).length).toBeGreaterThan(0);
});

const findHidden = node => {
  for (let item = node; item; item = item.parent) {
    if (item.props?.importantForAccessibility === 'no-hide-descendants' && item.props?.pointerEvents === 'none') return true;
  }
  return false;
};

test('手機沒有定位 sits where the distance would', async () => {
  await mount({ card: model({}, { phone: null }) });
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe(`位置沒有新位置・最後 09:05不在接收範圍${i18nT('c726')}`);
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
    === '位置，沒有新位置，最後 09:05，不在接收範圍，東北方 850 公尺，離手機')).not.toHaveLength(0);
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
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內桃園區中正路 1 號附近850 m');
  expect(heights()).toContain(56);
});

test('held indoors: 位置 「室內・N 分」 and 活動量 「休息中・已 N 分鐘」, each saying what it counts', async () => {
  const held = { heldReason: '室內', heldSource: 'good', heldFrom: NOW - 26 * 60000 - 5000, packetAt: NOW - 5000 };
  const fresh = { freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW }, range: null };
  const rows = [];
  for (let time = NOW - 30 * 60000; time < NOW; time += 10000) {
    rows.push({ time, activity: time < NOW - 12 * 60000 ? 0.3 : 0.02, activity_valid: 1, slave_id: 4 });
  }
  const activity = dogCardReadings({ local: rows }, NOW).activity;
  await mount({ card: model(held, { ...fresh, activity, address: '桃園區中正路 1 號附近' }) });
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內・26 分桃園區中正路 1 號附近850 m');
  expect(flatten(byTestId('dog-card-row-activity')[0])).toContain('休息中・已 12 分鐘');
  const labels = renderer.root.findAll(node => typeof node.props.accessibilityLabel === 'string', { deep: true })
    .map(node => node.props.accessibilityLabel);
  expect(labels).toContain('位置，室內，26 分，桃園區中正路 1 號附近，東北方 850 公尺，離手機');
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

test('E06: status labels reserve scaled width instead of wrapping at 1.3x', async () => {
  const rn = require('react-native');
  jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 390, height: 800, scale: 1, fontScale: 1.3 });
  await mount();
  const label = renderer.root.findAllByType(Text).find(node => node.props.children === '位置');
  const { size: sizes } = require('../src/theme/tokens');
  let cell = label.parent;
  while (cell && !rn.StyleSheet.flatten(cell.props.style)?.width) cell = cell.parent;
  expect(rn.StyleSheet.flatten(cell.props.style).width).toBe(sizes.card.labelWidth * 1.3);
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
