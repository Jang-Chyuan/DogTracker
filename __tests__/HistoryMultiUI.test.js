import { t as i18nT } from '../src/i18n';
// 055b: several dogs (H7) and 資料來源 on the history screen, drawn from the
// fixtures' rows through useHistoryScreen as MapScreen does.
import React from 'react';
import { Animated } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { colors } from '../src/theme/tokens';

const LEVELS = { summary: 140, half: 420, full: 620 };
const ALIASES = { 4: '豆豆', 6: '小黑', 8: '阿福' };
const CANDIDATES = [4, 5, 8].map(id => ({ id, name: ALIASES[id] ?? `狗 ${id}`, avatar: null }));

function Harness({ fixture, onScreen, screenRef }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `multi:${fixture.name}:`,
    preset: fixture.historyView ?? null, aliases: ALIASES });
  onScreen(screen);
  return <HistoryScreen ref={screenRef} screen={screen} top={24} levels={LEVELS} bottomInset={0} history={null}
    candidates={CANDIDATES.filter(dog => [...fixture.raw.ble, ...fixture.raw.cloud].some(row => row.slave_id === dog.id))} initialSheet={fixture.historyView?.sheet ?? null} />;
}

async function mount(name) {
  const fixture = buildFixture(name);
  const state = { screen: null, ref: React.createRef() };
  await act(async () => {
    state.renderer = Renderer.create(<Harness fixture={fixture} screenRef={state.ref} onScreen={value => { state.screen = value; }} />);
  });
  await act(async () => {});
  await act(async () => {});
  state.text = () => JSON.stringify(state.renderer.toJSON());
  state.press = testID => state.renderer.root.findAll(node => node.props.testID === testID
    && typeof node.props.onPress === 'function')[0].props.onPress();
  return state;
}
const unmount = state => act(async () => state.renderer.unmount());

test('history-multi-dog (H7): one capsule, 豆豆 leads, 「豆豆・移動 x km」, the others thin with faces', async () => {
  const s = await mount('history-multi-dog');
  expect(s.screen.dogs.map(dog => [dog.id, dog.color, dog.protagonist])).toEqual([
    [6, colors.route1, false], [4, colors.route2, true], [8, colors.route3, false]]);
  expect(s.text()).toMatch(/豆豆・移動 \d+\.\d km/);
  expect(s.text()).not.toContain('資料來源');
  expect(s.screen.map.cursor.face.name).toBe('豆豆');
  expect(s.screen.map.faces.map(face => face.id).sort()).toEqual([6, 8]);
  expect(s.screen.map.places.length).toBeGreaterThan(0);
  const range = s.screen.range;
  // 換主角: 阿福 leads, the range and the cursor's time stay.
  const time = s.screen.cursor.time;
  await act(async () => s.press('history-dogs-pill'));
  await act(async () => s.press('history-dog-8'));
  expect(s.screen.protagonist).toBe(8);
  expect(s.screen.range).toEqual(range);
  expect(s.screen.cursor.time).toBe(time);
  expect(s.screen.focus).toMatchObject({ action: 'protagonist', id: 8 });
  expect(s.text()).toMatch(/阿福・移動/);
  // The protagonist is protected; switch first, then remove 阿福.
  expect(s.renderer.root.findAllByProps({ testID: 'history-remove-8' })).toHaveLength(0);
  await act(async () => s.press('history-dog-4'));
  await act(async () => s.press('history-remove-8'));
  expect(s.screen.dogs.map(dog => [dog.id, dog.color])).toEqual([[6, colors.route1], [4, colors.route2]]);
  expect(s.screen.protagonist).not.toBe(8);
  await unmount(s);
});

test('「＋ 加入」: the list, a dog without records faded, added with the smallest free colour; full at four', async () => {
  const s = await mount('history-multi-add');
  expect(s.text()).toContain(i18nT('c403'));
  expect(s.text()).toContain(i18nT('c327'));
  expect(s.text()).not.toContain('訊號源 6');
  await act(async () => s.screen.addDog({ id: 8, hasData: true }));
  expect(s.screen.dogs.map(dog => [dog.id, dog.color])).toEqual([[6, colors.route1], [8, colors.route2]]);
  await unmount(s);
  const four = await mount('history-multi-four');
  expect(four.screen.full).toBe(true);
  await act(async () => four.press('history-dogs-pill'));
  expect(four.text()).toContain(i18nT('c326', { count: 4 }));
  expect(four.text()).toContain(i18nT('c403'));
  await unmount(four);
});

test('history-multi-no-data: 狗 5 has no record today — faded, never the protagonist, not drawn', async () => {
  const s = await mount('history-multi-no-data');
  const five = s.screen.dogs.find(dog => dog.id === 5);
  expect(five).toMatchObject({ hasData: false, selectable: false });
  await act(async () => s.press('history-dogs-pill'));
  await act(async () => s.press('history-dog-5'));
  expect(s.screen.protagonist).toBe(6);
  expect(s.screen.map.faces ?? []).toEqual([]);
  await unmount(s);
});

test('history-multi-cursor: a dog without data at the cursor waits grey at its last fix', async () => {
  const s = await mount('history-multi-cursor');
  const cursors = s.screen.cursors;
  expect(cursors[6].stale).toBe(false);
  expect(cursors[8].stale).toBe(true);
  expect(cursors[8].point.time).toBeLessThan(s.screen.cursor.time);
  expect(s.screen.map.faces.find(face => face.id === 8).stale).toBe(true);
  await unmount(s);
});

test('my route has no 資料來源 row and no ＋ 加入', async () => {
  const s = await mount('history-my-route');
  expect(s.text()).not.toContain('資料來源');
  expect(s.text()).not.toContain('＋ 加入');
  await unmount(s);
});

test('再次進入: leaving and opening the same dog again starts over (the entry dog alone, 全部)', async () => {
  const fixture = buildFixture('history-multi-dog');
  let screen;
  function Probe({ open }) {
    screen = useHistoryScreen({ target: open ? { subject: 'dog', slaveId: 6 } : null, read: fixture.history.readDay,
      readDays: fixture.history.readDays, owner: fixture.cloudSync.ownerId, clock: () => fixture.now,
      memoryScope: 'reopen:' });
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe open />); });
  await act(async () => screen.addDog({ id: 4, hasData: true }));
  expect(screen.dogs).toHaveLength(2);
  await act(async () => renderer.update(<Probe open={false} />));
  await act(async () => renderer.update(<Probe open />));
  expect(screen.dogs.map(dog => dog.id)).toEqual([6]);
  expect(screen).not.toHaveProperty('source');
  await act(async () => renderer.unmount());
});

test('chooser stays open after immediate add, switch and remove; Back closes it first', async () => {
  const s = await mount('history-dogs-sheet-three');
  expect(s.text()).toContain(i18nT('c403'));
  const range = s.screen.range;
  const time = s.screen.cursor.time;
  await act(async () => s.press('history-add-5'));
  expect(s.screen.dogs).toHaveLength(4);
  expect(s.text()).toContain(i18nT('c403'));
  expect(s.text()).toContain(i18nT('c326', { count: 4 }));
  await act(async () => s.press('history-dog-4'));
  expect(s.screen.protagonist).toBe(4);
  expect(s.renderer.root.findAllByProps({ testID: 'history-remove-4' })).toHaveLength(0);
  await act(async () => s.screen.removeDog(4));
  expect(s.screen.dogs).toHaveLength(4);
  await act(async () => s.press('history-remove-8'));
  expect(s.screen.dogs.map(dog => dog.id)).toEqual([6, 4, 5]);
  expect(s.screen.range).toEqual(range);
  expect(s.screen.cursor.time).toBe(time);
  const animation = jest.spyOn(Animated, 'timing').mockReturnValue({ start: done => done?.({ finished: true }) });
  await act(async () => expect(s.ref.current.back()).toBe(true));
  animation.mockRestore();
  expect(s.text()).not.toContain(i18nT('c403'));
  await unmount(s);
});

test('「看哪幾隻狗」 rows are 56dp with 32dp faces (清單列; user 2026-10-09)', async () => {
  const DogAvatar = require('../src/dogs/DogAvatar').default;
  const { StyleSheet } = require('react-native');
  const s = await mount('history-dogs-sheet-three');
  const sheet = s.renderer.root.findByProps({ testID: 'history-dogs-sheet' });
  const faces = sheet.findAllByType(DogAvatar);
  expect(faces.length).toBeGreaterThan(1);
  faces.forEach(face => expect(face.props.size).toBe(32));
  const rows = ['history-dog-4', 'history-add-5'].map(id => s.renderer.root.findAll(node =>
    node.props.testID === id && typeof node.props.onPress === 'function')[0]);
  rows.forEach(row => {
    const style = typeof row.props.style === 'function' ? row.props.style({ pressed: false }) : row.props.style;
    expect(StyleSheet.flatten(style).minHeight).toBe(56);
  });
  await unmount(s);
});

test('the capsule\'s 「＋」 sits in a 32dp dashed accent circle with no fill (user 2026-10-09, B)', async () => {
  const { Circle } = require('react-native-svg');
  const s = await mount('history-dogs-one-addable');
  const plus = s.renderer.root.findByProps({ testID: 'history-dogs-plus' });
  const circle = plus.findByType(Circle);
  expect(circle.props).toMatchObject({ fill: 'none', stroke: colors.accent, strokeWidth: 1.5 });
  expect(circle.props.strokeDasharray).toBeTruthy();
  expect(plus.props.style).toMatchObject({ width: 32, height: 32 });
  await unmount(s);
});

test('no-record dog can be added immediately; outside tap closes the chooser', async () => {
  const s = await mount('history-dogs-sheet-no-record');
  expect(s.text()).toContain(i18nT('c327'));
  await act(async () => s.press('history-add-5'));
  expect(s.screen.dogs.find(dog => dog.id === 5).hasData).toBe(false);
  expect(s.text()).toContain(i18nT('c403'));
  const scrim = s.renderer.root.findAll(node => node.props.accessibilityLabel === '關閉看哪幾隻狗'
    && typeof node.props.onPress === 'function')[0];
  const animation = jest.spyOn(Animated, 'timing').mockReturnValue({ start: done => done?.({ finished: true }) });
  await act(async () => scrim.props.onPress());
  animation.mockRestore();
  expect(s.text()).not.toContain(i18nT('c403'));
  await unmount(s);
});

test('map face selection still switches protagonist without opening the chooser', async () => {
  const s = await mount('history-dogs-three');
  const range = s.screen.range;
  await act(async () => s.screen.selectDog(8));
  expect(s.screen.protagonist).toBe(8);
  expect(s.screen.range).toEqual(range);
  expect(s.text()).not.toContain(i18nT('c403'));
  await unmount(s);
});


test.each([
  ['history-dogs-one-addable', 1, true, '＋'],
  ['history-dogs-one-alone', 1, false, null],
  ['history-dogs-three', 3, true, '▾'],
  ['history-dogs-four', 4, true, '+1'],
  ['history-dogs-sheet-three', 3, true, '看哪幾隻狗'],
  ['history-dogs-sheet-four', 4, true, '最多同時 4 隻'],
])('%s renders the approved capsule state', async (fixture, count, tappable, text) => {
  const s = await mount(fixture);
  expect(s.screen.dogs).toHaveLength(count);
  const control = s.renderer.root.findAll(node => typeof node.type === 'string'
    && node.props.testID === 'history-dogs-pill')[0];
  expect(control.props.accessibilityRole === 'button').toBe(tappable);
  if (text) expect(s.text()).toContain(text);
  await unmount(s);
});
