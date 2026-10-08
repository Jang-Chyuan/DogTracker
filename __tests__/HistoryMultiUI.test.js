// 055b: several dogs (H7) and 資料來源 on the history screen, drawn from the
// fixtures' rows through useHistoryScreen as MapScreen does.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { colors } from '../src/theme/tokens';

const LEVELS = { summary: 140, half: 420, full: 620 };
const ALIASES = { 4: '豆豆', 6: '小黑', 8: '阿福' };
const CANDIDATES = [4, 5, 8].map(id => ({ id, name: ALIASES[id] ?? `狗 ${id}`, avatar: null }));

function Harness({ fixture, onScreen }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `multi:${fixture.name}:`,
    preset: fixture.historyView ?? null, aliases: ALIASES });
  onScreen(screen);
  return <HistoryScreen screen={screen} top={24} levels={LEVELS} bottomInset={0} history={null}
    candidates={CANDIDATES} initialSheet={fixture.historyView?.sheet ?? null} />;
}

async function mount(name) {
  const fixture = buildFixture(name);
  const state = { screen: null };
  await act(async () => {
    state.renderer = Renderer.create(<Harness fixture={fixture} onScreen={value => { state.screen = value; }} />);
  });
  await act(async () => {});
  await act(async () => {});
  state.text = () => JSON.stringify(state.renderer.toJSON());
  state.press = testID => state.renderer.root.findAll(node => node.props.testID === testID
    && typeof node.props.onPress === 'function')[0].props.onPress();
  return state;
}
const unmount = state => act(async () => state.renderer.unmount());

test('history-multi-dog (H7): three chips, 豆豆 leads, 「豆豆・移動 x km」, the others thin with faces', async () => {
  const s = await mount('history-multi-dog');
  expect(s.screen.dogs.map(dog => [dog.id, dog.color, dog.protagonist])).toEqual([
    [6, colors.route1, false], [4, colors.route2, true], [8, colors.route3, false]]);
  expect(s.text()).toMatch(/豆豆・移動 \d+\.\d km/);
  expect(s.text()).toContain('資料來源：全部 ›');
  expect(s.screen.map.cursor.face.name).toBe('豆豆');
  expect(s.screen.map.faces.map(face => face.id).sort()).toEqual([6, 8]);
  expect(s.screen.map.places.length).toBeGreaterThan(0);
  const range = s.screen.range;
  // 換主角: 阿福 leads, the range and the cursor's time stay.
  const time = s.screen.cursor.time;
  await act(async () => s.press('history-dog-8'));
  expect(s.screen.protagonist).toBe(8);
  expect(s.screen.range).toEqual(range);
  expect(s.screen.cursor.time).toBe(time);
  expect(s.screen.focus).toMatchObject({ action: 'protagonist', id: 8 });
  expect(s.text()).toMatch(/阿福・移動/);
  // ✕: 阿福 goes, the colours of the others stay.
  await act(async () => s.press('history-remove-8'));
  expect(s.screen.dogs.map(dog => [dog.id, dog.color])).toEqual([[6, colors.route1], [4, colors.route2]]);
  expect(s.screen.protagonist).not.toBe(8);
  await unmount(s);
});

test('「＋ 加入」: the list, a dog without records faded, added with the smallest free colour; full at four', async () => {
  const s = await mount('history-multi-add');
  expect(s.text()).toContain('加入狗');
  expect(s.text()).toContain('沒有紀錄');
  expect(s.text()).not.toContain('訊號源 6');
  await act(async () => s.screen.addDog({ id: 8, hasData: true }));
  expect(s.screen.dogs.map(dog => [dog.id, dog.color])).toEqual([[6, colors.route1], [8, colors.route2]]);
  await unmount(s);
  const four = await mount('history-multi-four');
  expect(four.screen.full).toBe(true);
  await act(async () => four.press('history-add'));
  expect(four.text()).toContain('最多同時 4 隻');
  expect(four.renderer.root.findAll(node => node.props.testID === 'history-add-sheet')).toHaveLength(0);
  await unmount(four);
});

test('history-multi-no-data: 狗 5 has no record today — faded, never the protagonist, not drawn', async () => {
  const s = await mount('history-multi-no-data');
  const five = s.screen.dogs.find(dog => dog.id === 5);
  expect(five).toMatchObject({ hasData: false, selectable: false });
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

test('資料來源: the picker, 雲端 without records (H8 with the row), 這支手機收到的 leaves the cloud dog out', async () => {
  const picker = await mount('history-source-picker');
  expect(picker.text()).toContain('這支手機收到的');
  await act(async () => picker.screen.setSource('cloud'));
  expect(picker.screen.source).toBe('cloud');
  await unmount(picker);
  const empty = await mount('history-source-empty');
  expect(empty.text()).toContain('這天沒有小黑的紀錄');
  expect(empty.text()).toContain('資料來源：雲端 ›');
  await unmount(empty);
  const local = await mount('history-source-local');
  expect(local.screen.protagonist).not.toBe(8);
  expect(local.screen.dogs.find(dog => dog.id === 8).hasData).toBe(false);
  await unmount(local);
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
  await act(async () => screen.setSource('local'));
  expect(screen.dogs).toHaveLength(2);
  await act(async () => renderer.update(<Probe open={false} />));
  await act(async () => renderer.update(<Probe open />));
  expect(screen.dogs.map(dog => dog.id)).toEqual([6]);
  expect(screen.source).toBe('all');
  await act(async () => renderer.unmount());
});
