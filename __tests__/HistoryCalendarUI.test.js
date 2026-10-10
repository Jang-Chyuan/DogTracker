import { t as i18nT } from '../src/i18n';
// 054b: the date row's calendar (H3b), 選月份 (H3e) and a day only the cloud
// holds (H3c, H3d), drawn from the fixtures through useHistoryScreen as
// MapScreen does.
import React from 'react';
import { StyleSheet } from 'react-native';
import { radius } from '../src/theme/tokens';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';

const LEVELS = { summary: 140, half: 420, full: 620 };

// The system font scale (React Native's test window says 2): the grid at 100%,
// the 200% list where a test asks for it.
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 851, scale: 2.75, fontScale: mockFontScale }),
}));
afterEach(() => { mockFontScale = 1; });

function Harness({ fixture, onScreen, screenRef, online, active = true }) {
  const target = historyTargetOf(fixture.history.preferences);
  const cloud = fixture.historyCloud;
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `test:${fixture.name}:`,
    preset: fixture.historyView ?? null, cloud: cloud?.cloud ?? null, active,
    online: online ?? cloud?.online !== false, cloudSeed: cloud?.seed ?? null });
  onScreen?.(screen);
  return <HistoryScreen ref={screenRef} screen={screen} top={24} levels={LEVELS} bottomInset={0} name="小黑"
    history={null} initialCalendar={fixture.historyView?.calendar ?? null} />;
}

async function mount(name) {
  const fixture = buildFixture(name);
  const state = { screen: null, renderer: null, ref: React.createRef(), fixture };
  await act(async () => {
    state.renderer = Renderer.create(<Harness fixture={fixture} screenRef={state.ref}
      onScreen={value => { state.screen = value; }} />);
  });
  await settle(0);
  state.text = () => JSON.stringify(state.renderer.toJSON());
  state.has = testID => state.renderer.root.findAll(node => node.props.testID === testID).length > 0;
  state.press = async testID => {
    const node = state.renderer.root.findAll(n => n.props.testID === testID && typeof n.props.onPress === 'function')[0];
    if (!node) throw new Error(`nothing to press: ${testID}`);
    await act(async () => { node.props.onPress(); });
  };
  state.cell = day => state.renderer.root.findAll(n => n.props.testID === `calendar-day-${day}`
    && n.props.accessibilityLabel)[0];
  return state;
}

async function settle(ms) {
  await act(async () => { jest.advanceTimersByTime(ms); });
  for (let i = 0; i < 6; i += 1) await act(async () => { jest.advanceTimersByTime(300); });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('H3b: dots on this phone\'s and the cloud\'s days, grey empty and future days, 回到今天 faded on today', async () => {
  const s = await mount('history-calendar');
  expect(s.has('history-calendar')).toBe(true);
  expect(s.text()).toContain(i18nT('c144'));
  expect(s.text()).toContain('2026 年 10 月');
  expect(s.text()).not.toContain('灰字＝沒有紀錄，不能點');
  // The October walk found the cloud's 9/28 and 10/3; all its days are known.
  expect(s.screen.knowledge.cloud).toEqual(expect.arrayContaining(['2026-09-28', '2026-10-03', '2026-08-12']));
  expect(s.cell('2026-09-28').props.accessibilityLabel).toBe('9 月 28 日，有紀錄，只在雲端');
  expect(s.cell('2026-09-29').props.accessibilityLabel).toBe('9 月 29 日，有紀錄');
  expect(s.cell('2026-10-01').props.accessibilityLabel).toBe('10 月 1 日，沒有紀錄');
  expect(s.cell('2026-10-08').props.accessibilityLabel).toBe('10 月 8 日，還沒到');
  expect(s.cell('2026-10-07').props.accessibilityState).toEqual({ disabled: false, selected: true });
  expect(s.text()).not.toContain(i18nT('c324'));
  const frame = s.cell('2026-10-07').findAll(n => n.props.collapsable === false && StyleSheet.flatten(n.props.style)?.borderRadius === radius.full)[0];
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ width: 44, maxWidth: '100%', aspectRatio: 1, borderRadius: radius.full });
  const today = s.renderer.root.findAll(n => n.props.testID === 'calendar-today' && n.props.accessibilityState)[0];
  expect(today.props.accessibilityState.disabled).toBe(true);
  // A day without records does nothing at all.
  expect(s.cell('2026-10-01').props.onPress).toBeUndefined();
  await act(async () => s.renderer.unmount());
});

test('choosing a day this phone holds closes the calendar and shows it; the date row steps over the cloud days', async () => {
  const s = await mount('history-calendar');
  await act(async () => { s.cell('2026-09-30').props.onPress(); });
  await settle(400);
  expect(s.has('history-calendar')).toBe(false);
  expect(s.text()).toContain('9/30（三）');
  expect(s.screen.dayKey).toBe('2026-09-30');
  // ‹ › between this phone's days and the cloud days found: 9/29 ← → 10/2.
  expect(s.screen.navigation).toEqual({ previous: '2026-09-29', next: '2026-10-02' });
  await act(async () => s.renderer.unmount());
});

test('H3c: a day only the cloud holds downloads (取消 shown), then the day appears', async () => {
  const s = await mount('history-calendar');
  await act(async () => { s.cell('2026-09-28').props.onPress(); });
  await settle(0);
  expect(s.has('history-calendar')).toBe(false);
  expect(s.text()).toContain('9/28（一）');
  expect(s.text()).toContain('下載 9/28 的紀錄…');
  expect(s.text()).toContain(i18nT('c1253'));
  expect(s.has('history-skeleton')).toBe(true);
  const exportButton = s.renderer.root.findAll(n => n.props.testID === 'history-export' && n.props.accessibilityLabel)[0];
  expect(exportButton.props.accessibilityLabel).toBe(i18nT("c832"));
  await settle(3600);
  expect(s.text()).not.toContain('下載 9/28 的紀錄…');
  expect(s.screen.model.dayRecords).toBe(true);
  expect(s.screen.knowledge.local).toContain('2026-09-28');
  await act(async () => s.renderer.unmount());
});

test('H3c 取消 / 返回鍵: the download stops, 這天的紀錄還沒下載完 and 重試 (not H8)', async () => {
  const s = await mount('history-cloud-downloading');
  expect(s.text()).toContain('下載 9/28 的紀錄…');
  // 返回鍵 while downloading = 取消.
  let used;
  await act(async () => { used = s.ref.current.back(); });
  expect(used).toBe(true);
  await settle(0);
  expect(s.text()).toContain(i18nT('c321'));
  expect(s.text()).not.toContain(i18nT('c424'));
  expect(s.text()).not.toContain('這天沒有小黑的紀錄');
  expect(s.screen.dayKey).toBe('2026-09-28');
  await s.press('history-download-retry');
  expect(s.text()).toContain('下載 9/28 的紀錄…');
  await s.press('history-download-cancel');
  await settle(0);
  expect(s.text()).toContain(i18nT('c321'));
  expect(s.text()).not.toContain(i18nT('c424'));
  await act(async () => s.renderer.unmount());
});

test('a failed download with nothing here: 這天的紀錄還沒下載完; half a day: that half and 資料不完整　重試', async () => {
  const failed = await mount('history-cloud-failed');
  await settle(1600);
  expect(failed.text()).toContain(i18nT('c321'));
  await act(async () => failed.renderer.unmount());
  const partial = await mount('history-cloud-incomplete');
  await settle(1600);
  expect(partial.has('history-incomplete')).toBe(true);
  expect(partial.text()).toContain(i18nT("c686"));
  expect(partial.screen.model.dayRecords).toBe(true);
  await act(async () => partial.renderer.unmount());
});

test('‹ › while downloading = 取消, then the other day', async () => {
  const s = await mount('history-cloud-downloading');
  expect(s.screen.downloadingDay ?? s.screen.download?.kind).toBe('downloading');
  await s.press('history-day-next');
  await settle(0);
  expect(s.screen.dayKey).toBe('2026-09-29');
  expect(s.screen.download).toBe(null);
  await act(async () => s.renderer.unmount());
});

test('H3d: no network — the calendar and the day stay, with the sentence at the bottom', async () => {
  const s = await mount('history-cloud-offline');
  await act(async () => { s.cell('2026-09-28').props.onPress(); });
  await settle(0);
  expect(s.has('history-calendar')).toBe(true);
  expect(s.screen.dayKey).toBe('2026-10-07');
  expect(s.text()).toContain('沒有網路，9/28 的紀錄還沒下載，連上網路再試');
  await act(async () => s.renderer.unmount());
});

test('查詢中… then 雲端的紀錄查不到　重試; unknown days wait, then can be tapped', async () => {
  const querying = await mount('history-calendar-querying');
  expect(querying.text()).toContain(i18nT('c324'));
  expect(querying.cell('2026-10-05').props.onPress).toBeUndefined();
  expect(querying.cell('2026-10-05').props.accessibilityLabel).toBe('10 月 5 日，查詢中');
  // Days this phone holds and today can be chosen while asking.
  expect(typeof querying.cell('2026-10-02').props.onPress).toBe('function');
  await act(async () => querying.renderer.unmount());
  const failed = await mount('history-calendar-failed');
  expect(failed.text()).toContain(i18nT("c809"));
  expect(failed.text()).toContain(i18nT('c049'));
  expect(typeof failed.cell('2026-10-05').props.onPress).toBe('function');
  await act(async () => failed.renderer.unmount());
});

test('signed out: only this phone\'s days, the cloud is never asked', async () => {
  const s = await mount('history-calendar-signed-out');
  expect(s.text()).not.toContain(i18nT('c324'));
  expect(s.cell('2026-09-28').props.accessibilityLabel).toBe('9 月 28 日，沒有紀錄');
  expect(s.cell('2026-09-29').props.accessibilityLabel).toBe('9 月 29 日，有紀錄');
  await act(async () => s.renderer.unmount());
});

test('H3e: 選月份, the months with records, back to the month; 返回鍵 order 選月份 → 選日期 → closed', async () => {
  const s = await mount('history-month-picker');
  expect(s.text()).toContain(i18nT("c800"));
  expect(s.text()).toContain('2026 年');
  expect(s.text()).not.toContain('這個月有紀錄')
  expect(s.text()).not.toContain('灰字＝沒有紀錄或還沒到，不能點');
  const month = n => s.renderer.root.findAll(node => node.props.testID === `calendar-month-${n}`
    && node.props.accessibilityLabel)[0];
  const monthStyle = month(8).props.style;
  expect(StyleSheet.flatten(typeof monthStyle === 'function' ? monthStyle({ pressed: false }) : monthStyle))
    .toMatchObject({ borderRadius: radius.full, minHeight: 56 });
  expect(month(8).props.accessibilityLabel).toBe('8 月，有紀錄');
  expect(month(7).props.accessibilityLabel).toBe('7 月，沒有紀錄');
  expect(month(11).props.onPress).toBeUndefined();
  await act(async () => { month(9).props.onPress(); });
  await settle(0);
  expect(s.text()).toContain('2026 年 9 月');
  await s.press('calendar-month-title');
  expect(s.text()).toContain(i18nT("c800"));
  await act(async () => { s.ref.current.back(); });
  expect(s.text()).toContain(i18nT('c144'));
  await act(async () => { s.ref.current.back(); });
  await settle(400);
  expect(s.has('history-calendar')).toBe(false);
  await act(async () => s.renderer.unmount());
});

test('the date opens the calendar on the month of the day shown', async () => {
  const s = await mount('history-dog');
  expect(s.has('history-calendar')).toBe(false);
  await s.press('history-date');
  await settle(0);
  expect(s.has('history-calendar')).toBe(true);
  expect(s.text()).toContain('2026 年 10 月');
  await act(async () => s.renderer.unmount());
});

test('paused while the cloud is asked (app in the background): asked again in front, not stuck on 查詢中…', async () => {
  const fixture = buildFixture('history-calendar');
  let screen;
  const ref = React.createRef();
  let renderer;
  const draw = active => <Harness fixture={fixture} screenRef={ref} active={active}
    onScreen={value => { screen = value; }} />;
  await act(async () => { renderer = Renderer.create(draw(true)); });
  await act(async () => { jest.advanceTimersByTime(100); });
  await act(async () => { renderer.update(draw(false)); });
  expect(screen.knowledge.query).toBe('idle');
  await act(async () => { renderer.update(draw(true)); });
  await settle(0);
  expect(screen.knowledge.query).toBe('idle');
  expect(screen.knowledge.earliest).toBe('2026-08-12');
  expect(JSON.stringify(renderer.toJSON())).not.toContain(i18nT('c324'));
  await act(async () => renderer.unmount());
});

test('a day left incomplete says so after another day, and is downloaded again when chosen', async () => {
  const s = await mount('history-cloud-incomplete');
  await settle(1600);
  expect(s.screen.download).toMatchObject({ kind: 'incomplete' });
  await act(async () => { s.screen.goTo('2026-09-29'); });
  await settle(0);
  expect(s.screen.download).toBe(null);
  let result;
  await act(async () => { result = s.screen.goTo('2026-09-28'); });
  expect(result.type).toBe('download');
  expect(s.text()).toContain('下載 9/28 的紀錄…');
  await act(async () => s.renderer.unmount());
});

test('200% font: the month is a list of the days with records and today; a row chooses its day (060)', async () => {
  mockFontScale = 2;
  const s = await mount('history-calendar');
  expect(s.has('calendar-list')).toBe(true);
  expect(s.cell('2026-10-01')).toBeUndefined();
  const rows = s.renderer.root.findAll(n => /^calendar-row-/.test(n.props.testID ?? '') && n.props.accessibilityLabel)
    .map(n => n.props.testID.slice('calendar-row-'.length));
  expect(rows[0]).toBe('2026-10-07');
  expect(rows).toEqual(expect.arrayContaining(['2026-10-03', '2026-10-02']));
  expect(rows).not.toContain('2026-10-01');
  await s.press('calendar-row-2026-10-02');
  await settle(400);
  expect(s.has('history-calendar')).toBe(false);
  expect(s.text()).toContain('10/02（五）');
});
