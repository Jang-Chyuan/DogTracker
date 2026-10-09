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
  range: { status: RANGE_STATUS.NEAR, judgedAt: NOW, cloudOnly: false },
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

test('A3b on screen: name, 訊號源, headline, rows in order, red and amber 「!」, no receiver row', async () => {
  const { onHeight } = await mount();
  // What it covers: its height and the 8dp it floats above the screen edge.
  expect(onHeight).toHaveBeenLastCalledWith(428);
  const text = flatten(renderer.toJSON());
  expect(text).toContain('豆豆');
  expect(text).toContain('訊號源 4');
  expect(text).toContain('845 m');
  expect(text).toContain('離手機・最後位置');
  const order = ['位置', '電量', '接收範圍', '活動量'].map(label => text.indexOf(label));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(text).not.toContain(i18nT('c075'));
  expect(text).toContain(i18nT('c071'));
  // Problem values: dark red bold behind a red 「!」; 快離開: amber behind an amber 「!」.
  const value = words => renderer.root.findAllByType(Text).find(node => flatten(node.props.children) === words);
  expect(value('沒有新位置・最後 09:05').props.style).toEqual(expect.arrayContaining([{ color: colors.crit }]));
  expect(value(i18nT('c067')).props.style).toEqual(expect.arrayContaining([{ color: colors.warn }]));
  // The 「!」 circles are vectors (060): red for problems, amber for 快離開.
  const all = renderer.root.findAll(node => /^dog-card-mark-/.test(node.props.testID ?? '') && node.props.background);
  expect(all.filter(node => node.props.background === colors.problemBadge).length).toBeGreaterThanOrEqual(2);
  expect(all.filter(node => node.props.background === colors.warnIcon)).not.toHaveLength(0);
  // Rows have no fill (the design's correction): only the 「!」 is coloured.
  for (const id of ['position', 'battery', 'range', 'activity']) {
    const row = byTestId(`dog-card-row-${id}`)[0];
    const style = [row.props.style].flat(3).filter(Boolean);
    expect(style.some(item => item.backgroundColor)).toBe(false);
  }
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
  // The headline is a heading TalkBack reads as one.
  expect(renderer.root.findAll(node => node.props.accessibilityRole === 'header')[0].props.accessibilityLabel)
    .toBe('豆豆，東北方 845 公尺，離手機，最後位置');
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

test('a held dog\'s 位置 row is 64dp high (A7b); the address line shows once known, no spinner before', async () => {
  const held = { heldReason: '室內', heldSource: 'weak' };
  const fresh = { freshness: { stale: false, basis: 'packet', source: 'ble', lastAt: NOW } };
  const heights = () => [byTestId('dog-card-row-position')[0].props.style].flat(3).filter(Boolean)
    .map(item => item.minHeight).filter(Boolean);
  await mount({ card: model(held, fresh) });
  // Still asking, none found or offline: 「室內」 alone, no spinner, one line.
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內');
  expect(heights()).toContain(64);
  await act(async () => renderer.update(<DogCard card={model(held, { ...fresh, address: '桃園區中正路 1 號附近' })} />));
  expect(flatten(byTestId('dog-card-row-position')[0])).toBe('位置室內桃園區中正路 1 號附近');
  expect(heights()).toContain(64);
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
  const label = renderer.root.findAllByType(Text).find(node => node.props.children === '接收範圍');
  const { size: sizes } = require('../src/theme/tokens');
  expect(rn.StyleSheet.flatten(label.props.style).width).toBe(sizes.card.labelWidth * 1.3);
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
