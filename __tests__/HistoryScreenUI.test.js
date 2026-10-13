import { t as i18nT } from '../src/i18n';
// 055a: the history screen (H1/H2/H2b/H3a/H8) drawn from the fixtures'
// rows through useHistoryScreen, as MapScreen does.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import Glyph from '../src/map/Glyph';
import { buildFixture } from '../src/dev/ScreenFixtures';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { DAY_STEP_SETTLE_MAX_MS, historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { RANGE_RECOMPUTE_DELAY_MS } from '../src/mapHistory/useRangeRecompute';

const LEVELS = { summary: 140, half: 420, full: 620 };

function Harness({ fixture, onScreen, screenRef }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `test:${fixture.name}:`,
    preset: fixture.historyView ?? null });
  onScreen?.(screen);
  return <HistoryScreen ref={screenRef} screen={screen} top={24} levels={LEVELS} bottomInset={0}
    name={target.subject === 'dog' ? '豆豆' : ''} history={null} initialRangeOpen={!!fixture.historyView?.rangeOpen} initialExport={fixture.historyView?.export} />;
}

export async function mountFixture(name) {
  const fixture = buildFixture(name);
  const state = { screen: null, renderer: null, ref: React.createRef() };
  await act(async () => {
    state.renderer = Renderer.create(<Harness fixture={fixture} screenRef={state.ref}
      onScreen={value => { state.screen = value; }} />);
  });
  await act(async () => {});
  state.text = () => JSON.stringify(state.renderer.toJSON());
  state.ids = prefix => state.renderer.root.findAll(node => typeof node.type === 'string'
    && String(node.props.testID || '').startsWith(prefix)).map(node => node.props.testID);
  return state;
}

const pressable = (state, testID) => state.renderer.root.findAll(node => node.props.testID === testID
  && typeof node.props.onPress === 'function')[0];
// A range change shows its skeleton, then recomputes RANGE_RECOMPUTE_DELAY_MS
// after the busy render commits. On the wall clock that wait raced the
// assertions: act resolves on a later turn of the event loop, after a timers
// phase, so a runner stalled past 32 ms right after the commit (a loaded CI
// host) ran the recompute before the test could see the skeleton. The tests
// that change the range own that clock (the hook's own timing is covered by
// HistoryRangeRecompute.test.js).
const rangeClock = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
afterEach(() => jest.useRealTimers());
const settleRange = state => act(async () => {
  expect(state.screen.rangePending).toBe(true);
  expect(state.screen.dayModel).toBeNull();
  await jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS + 8);
});
const unmount = state => act(async () => state.renderer.unmount());

test('history-my-route (H1 我的路線): no title header, no ＋ 加入, the list, the summary, the map', async () => {
  const viewport = jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 1 });
  let s;
  try {
    s = await mountFixture('history-my-route');
    expect(s.ids('history-my-route-header')).toEqual([]);
    expect(s.ids('history-add')).toEqual([]);
    expect(s.ids('history-dogs-pill')).toEqual([]);
    expect(s.text()).toContain('10/07（三）今天');
    expect(s.text()).toContain(i18nT('c122'));
    expect(s.screen.navigation).toEqual({ previous: null, next: null });
    expect(s.ids('timeline-').filter(id => id !== 'timeline-selected')).toEqual(['timeline-departure',
      'timeline-movement-walking', 'timeline-stop', 'timeline-movement-walking', 'timeline-stop',
      'timeline-movement-driving', 'timeline-switch', 'timeline-movement-walking', 'timeline-stop',
      'timeline-movement-walking', 'timeline-end']);
    // The cursor on the newest fix: 「09:29」「已走 x km」, and its marker on the map.
    expect(s.screen.cursor.label[0]).toBe('09:29');
    expect(s.screen.cursor.label[1]).toMatch(/^已走 \d+\.\d km$/);
    const map = s.screen.map;
    expect(map.color).toBe('#1A73E8');
    expect(map.places.map(place => place.number)).toEqual([1, 2, 3, 4]);
    expect(map.lines.some(line => line.width === 2 && !line.dashed)).toBe(true);
    expect(map.times[0]).toMatchObject({ time: s.screen.model.points[0].time, end: true });
    expect(map.cursor.lines).toEqual(s.screen.cursor.label);
    const frame = s.renderer.root.findAllByProps({ testID: 'history-frame-all' })[0];
    const frameStyle = StyleSheet.flatten(frame.props.style);
    const enabledExport = pressable(s, 'history-export');
    const enabledExportStyle = StyleSheet.flatten(enabledExport.props.style);
    expect([enabledExportStyle.width, enabledExportStyle.height, enabledExportStyle.borderRadius])
      .toEqual([frameStyle.width, frameStyle.height, frameStyle.borderRadius]);
    expect(enabledExport.findByType(Glyph).props.size).toBe(frame.findByType(Glyph).props.size);
  } finally {
    if (s) await unmount(s);
    viewport.mockRestore();
  }
});

test('history-dog (H1 狗的歷史): the dog capsule, ＋ 加入, 移動 and 坐車', async () => {
  const s = await mountFixture('history-dog');
  expect(s.text()).toContain('豆豆');
  expect(s.ids('history-dogs-pill')).toEqual(['history-dogs-pill']);
  expect(s.ids('timeline-movement-ride')).toHaveLength(1);
  expect(s.screen.cursor.label[1]).toMatch(/^已移動 /);
  expect(s.screen.map.color).toBe('#D9604F');
  await unmount(s);
});

test('history-range-open (H2b): the bar open in its frame, 完成, the dragged start; no 「已手動調整」', async () => {
  const s = await mountFixture('history-range-open');
  rangeClock();
  expect(s.ids('history-range-bar')).toEqual(['history-range-bar']);
  expect(s.text()).not.toContain('拖兩端的圓點改開始、結束');
  expect(s.text()).toContain(i18nT('c101'));
  expect(s.text()).toContain(i18nT('c124'));
  expect(s.text()).not.toContain('已手動調整');
  expect(s.text()).toContain('07:50 – 現在');
  // The right handle says this minute, not 「現在」.
  expect(s.text()).toContain('"09:30"');
  // TalkBack moves each end on its own (a fix at least a minute on).
  const before = s.screen.range.start;
  const startHandle = s.renderer.root.findAll(node => node.props.testID === 'range-handle-start'
    && node.props.onAccessibilityAction)[0];
  await act(async () => startHandle.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  expect(s.ids('history-range-loading').length).toBeGreaterThan(0);
  expect(pressable(s, 'history-export').props.disabled).toBe(true);
  await settleRange(s);
  expect(s.screen.range.start).toBeGreaterThanOrEqual(before + 60000);
  expect(s.screen.range.following).toBe(true);
  // Back closes the bar first, then nothing more inside the screen.
  let used;
  await act(async () => { used = s.ref.current.back(); });
  expect(used).toBe(true);
  expect(s.ids('history-range-bar')).toEqual([]);
  expect(s.text()).toContain(i18nT('c122'));
  await act(async () => { used = s.ref.current.back(); });
  expect(used).toBe(false);
  await unmount(s);
});

test('a dragged range is kept for the day; the list and summary follow it', async () => {
  const s = await mountFixture('history-my-route');
  rangeClock();
  const day = s.screen.model.dayPoints;
  const start = day.find(p => p.time >= s.screen.model.points[0].time + 60 * 60000);
  await act(async () => s.screen.dragRange({ start: start.time, end: null, following: true }));
  await settleRange(s);
  expect(s.screen.model.points[0].time).toBe(start.time);
  await act(async () => s.screen.commitRange({ start: start.time, end: null, following: true }));
  await settleRange(s);
  expect(s.screen.manual).toBe(true);
  expect(s.text()).toContain(i18nT('c124'));
  await unmount(s);
  // Opened again (same fixture scope): the range is still the dragged one.
  const again = await mountFixture('history-my-route');
  expect(again.screen.model.points[0].time).toBe(start.time);
  await unmount(again);
});

test('a tap on a stay row: the cursor to its start, the row lit, a double haptic; 沒有資料 waits before the break', async () => {
  const NativePlatform = require('../specs/NativeTrackingPlatform').default;
  const s = await mountFixture('history-gap');
  NativePlatform.performHaptic.mockClear();
  const gap = s.screen.model.nodes.find(node => node.type === 'gap');
  await act(async () => pressable(s, 'timeline-gap-gap').props.onPress());
  expect(s.screen.cursor.stale).toBe(true);
  expect(s.screen.cursor.label[1]).toMatch(/^這段沒資料（最後 \d\d:\d\d）$/);
  expect(s.screen.cursor.point.time).toBeLessThanOrEqual(gap.start);
  await unmount(s);
  const r = await mountFixture('history-my-route');
  const stop = r.screen.model.nodes.find(node => node.type === 'stop');
  NativePlatform.performHaptic.mockClear();
  await act(async () => pressable(r, 'timeline-stop').props.onPress());
  expect(r.screen.cursor.point.time).toBe(stop.start);
  expect(r.screen.cursor.label[1]).toMatch(/^停留 \d+ 分$/);
  expect(r.screen.focus).toMatchObject({ action: 'node' });
  expect(r.ids('timeline-selected')).toHaveLength(1);
  expect(NativePlatform.performHaptic).toHaveBeenCalledWith('EFFECT_DOUBLE_CLICK');
  await unmount(r);
});

test('history-indoor: the house on the map, 室內・N 分 at the cursor inside the hold', async () => {
  const s = await mountFixture('history-indoor');
  const hold = s.screen.model.locations.find(node => node.type === 'indoor');
  expect(s.screen.map.places.some(place => place.kind === 'indoor')).toBe(true);
  await act(async () => s.screen.moveCursor(hold.start + 60000, 'drag'));
  expect(s.screen.cursor.label[1]).toMatch(/^室內・\d+ 分$/);
  await unmount(s);
});

test('history-single-point (只有一筆): one point, no distance, no range bar', async () => {
  const s = await mountFixture('history-single-point');
  expect(s.screen.model.points).toHaveLength(1);
  expect(s.text()).toContain('09:10 – 09:10');
  expect(s.ids('history-adjust')).toEqual([]);
  expect(s.screen.map.lines).toEqual([]);
  // 2026-10-13: the cursor's running distance under 100 m is in metres.
  expect(s.screen.cursor.label[1]).toBe('已移動 0 m');
  await unmount(s);
});

test.each([
  ['history-no-departure', 'not-departed', '06:30 – 現在'],
  // 2026-10-13: 出發 is where the walk began (the stay ends 09:25), not the
  // first fix of the stay that passed the three-minute gate (09:22).
  ['history-confirming', 'confirming', '09:24 – 現在'],
])('%s: summary and TalkBack show only the selected time range', async (fixture, status, title) => {
  const s = await mountFixture(fixture);
  expect(s.screen.model.departure.status).toBe(status);
  expect(s.text()).toContain(title);
  const summary = s.renderer.root.findByProps({ testID: 'history-summary' });
  const speech = summary.findAll(node => typeof node.type === 'string' && node.props.accessibilityLabel)
    .map(node => node.props.accessibilityLabel);
  expect(speech).toContainEqual(expect.stringContaining(`${title.replace(' – ', i18nT("c826"))}，走路 `));
  await unmount(s);
});

test('history-empty-day (H8): one line, export faded, ‹ goes to the day with a route', async () => {
  const s = await mountFixture('history-empty-day');
  expect(s.ids('history-empty')).toEqual(['history-empty']);
  expect(s.text()).toContain(i18nT('c159'));
  expect(s.ids('history-summary')).toEqual([]);
  const exportButton = s.renderer.root.findAll(node => node.props.testID === 'history-export'
    && node.props.accessibilityState)[0];
  expect(exportButton.props.accessibilityState.disabled).toBe(true);
  // Export and frame keep the same visible map-control footprint and full target.
  const exportStyle = StyleSheet.flatten(exportButton.props.style);
  expect([exportStyle.width, exportStyle.height]).toEqual([48, 48]);
  expect(exportButton.findByType(Glyph).props.size).toBe(22);
  expect(s.screen.navigation.previous).toBe('2026-10-06');
  expect(s.screen.navigation.next).toBeNull();
  await act(async () => pressable(s, 'history-day-previous').props.onPress());
  // The day is built once the taps settle on it (no next tap came).
  await act(async () => { await new Promise(resolve => setTimeout(resolve, DAY_STEP_SETTLE_MAX_MS + 20)); });
  expect(s.text()).toContain('10/06（二）');
  expect(s.text()).not.toContain(i18nT('c159'));
  expect(s.screen.model.points.length).toBeGreaterThan(0);
  // A past day: the end is its last fix (not 現在); › goes back to today.
  expect(s.screen.following).toBe(false);
  expect(s.screen.navigation.next).toBe('2026-10-07');
  await unmount(s);
});

test('‹ to another day shows the skeleton at once (no blank panel while the day is read and built)', async () => {
  const fixture = buildFixture('history-empty-day');
  const original = fixture.history.readDay;
  let gate = null;
  fixture.history.readDay = async args => { if (gate) await gate; return original(args); };
  const state = { screen: null };
  let renderer, open;
  await act(async () => {
    renderer = Renderer.create(<Harness fixture={fixture} onScreen={value => { state.screen = value; }} />);
  });
  await act(async () => {});
  const skeleton = () => renderer.root.findAll(node => node.props.testID === 'history-skeleton').length;
  try {
    expect(state.screen.model).not.toBeNull();
    expect(skeleton()).toBe(0);
    gate = new Promise(resolve => { open = resolve; });
    const previous = renderer.root.findAll(node => node.props.testID === 'history-day-previous'
      && typeof node.props.onPress === 'function')[0];
    await act(async () => previous.props.onPress());
    // No timer has run: a busy JavaScript thread could not fire the delay.
    expect(state.screen.model).toBeNull();
    expect(skeleton()).toBeGreaterThan(0);
    await act(async () => open());
    // Still the skeleton until the taps settle on this day.
    expect(state.screen.model).toBeNull();
    expect(skeleton()).toBeGreaterThan(0);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, DAY_STEP_SETTLE_MAX_MS + 20)); });
    expect(state.screen.model.points.length).toBeGreaterThan(0);
    expect(skeleton()).toBe(0);
  } finally { open?.(); await act(async () => renderer.unmount()); }
});

describe('the screen over time', () => {
  const { startOfToday } = require('../src/tracking/TodayDistance');
  const { useHistoryDayRows } = require('../src/mapHistory/useHistoryScreen');

  test('over midnight the screen keeps its day; 「今天」 is gone and the end no longer follows', async () => {
    const fixture = buildFixture('history-my-route');
    let screen;
    function Probe({ clock }) {
      screen = useHistoryScreen({ target: { subject: 'phone', slaveId: null }, read: fixture.history.readDay,
        readDays: fixture.history.readDays, clock, memoryScope: 'midnight:' });
      return null;
    }
    let renderer;
    await act(async () => { renderer = Renderer.create(<Probe clock={() => fixture.now} />); });
    await act(async () => {});
    const day = startOfToday(fixture.now);
    expect(screen.today).toBe(true);
    const tomorrow = day + 24 * 3600000 + 5 * 60000;
    await act(async () => renderer.update(<Probe clock={() => tomorrow} />));
    await act(async () => {});
    expect(screen.day).toBe(day);
    expect(screen.today).toBe(false);
    expect(screen.following).toBe(false);
    expect(screen.navigation.next).toBe('2026-10-08');
    await act(async () => renderer.unmount());
  });

  test('a remembered range left without a minute of fixes goes back to the automatic range', async () => {
    const fixture = buildFixture('history-my-route');
    const day = startOfToday(fixture.now);
    let screen;
    function Probe() {
      screen = useHistoryScreen({ target: { subject: 'phone', slaveId: null }, read: fixture.history.readDay,
        readDays: fixture.history.readDays, clock: () => fixture.now, memoryScope: 'emptied:',
        preset: { manual: { start: day + 60000, end: day + 90000, following: false } } });
      return null;
    }
    let renderer;
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => {});
    await act(async () => {});
    expect(screen.manual).toBe(false);
    expect(screen.model.points.length).toBeGreaterThan(100);
    await act(async () => renderer.unmount());
  });

  test('a read that works again clears an earlier failure', async () => {
    jest.useFakeTimers();
    try {
      let fail = false;
      const read = jest.fn(async () => {
        if (fail) throw new Error('資料庫忙碌');
        return { rows: [], seed: [], after: { done: true } };
      });
      let result;
      function Probe() {
        result = useHistoryDayRows({ read, subject: 'phone', slaveId: null, day: startOfToday(Date.now()),
          clock: Date.now });
        return null;
      }
      let renderer;
      await act(async () => { renderer = Renderer.create(<Probe />); });
      expect(result.loaded).toBe(true);
      fail = true;
      await act(async () => jest.advanceTimersByTimeAsync(15000));
      expect(result.error).toBe('資料庫忙碌');
      fail = false;
      await act(async () => jest.advanceTimersByTimeAsync(15000));
      expect(result.error).toBe('');
      await act(async () => renderer.unmount());
    } finally {
      jest.useRealTimers();
    }
  });
});


test.each(['history-export', 'history-export-hang', 'history-export-fail-once',
  'history-export-multi', 'history-export-day'])('%s: export descriptions match D16 on screen and TalkBack in PNG / GPX / CSV order', async name => {
  const s = await mountFixture(name);
  const rows = s.renderer.root.findAll(node => typeof node.type === 'string'
    && ['history-export-png', 'history-export-gpx', 'history-export-csv'].includes(node.props.testID));
  expect(rows.map(node => node.props.testID)).toEqual(['history-export-png', 'history-export-gpx', 'history-export-csv']);
  expect(rows.map(node => node.props.accessibilityLabel)).toEqual([
    'PNG 長圖，分享', 'GPX，分享', 'CSV，分享',
  ]);
  const descriptions = s.renderer.root.findAll(node => typeof node.type === 'string'
    && ['history-export-format-png', 'history-export-format-gpx', 'history-export-format-csv'].includes(node.props.testID));
  expect(rows.every(node => node.findAllByType('Text').length === 0)).toBe(true);
  expect(descriptions.map(node => node.findAllByType('Text').map(text => text.props.children))).toEqual([
    [i18nT('c161'), i18nT('c162')], ['GPX', i18nT('c165')], ['CSV', i18nT('c167')],
  ]);
  expect(s.text()).not.toContain('傳 LINE 最方便');
  expect(s.text()).not.toContain('上次用');
  await unmount(s);
});

test('range bar: a quick flick lands where the finger let go, even when its last moves never reached JS', async () => {
  const { PanResponder } = require('react-native');
  const s = await mountFixture('history-manual-end');
  rangeClock();
  const created = [];
  const spy = jest.spyOn(PanResponder, 'create').mockImplementation(value => { created.push(value); return { panHandlers: {} }; });
  try {
    await act(async () => pressable(s, 'history-adjust').props.onPress());
    const bar = s.renderer.root.findAll(node => node.props.testID === 'history-range-bar')[0];
    const area = bar.findAll(node => typeof node.props.onLayout === 'function')[0];
    await act(async () => area.props.onLayout({ nativeEvent: { layout: { width: 348 } } }));
    const handlers = created.find(value => String(value.onPanResponderGrant).includes("middle"));
    const before = s.screen.range;
    expect(before.following).toBe(false);
    // Touch right of the middle (the end handle), then let go 20 dp further
    // left with no move delivered in between.
    await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: 348 } }));
    await act(async () => handlers.onPanResponderRelease(null, { dx: -20, dy: 0 }));
    await settleRange(s);
    const flicked = s.screen.range;
    expect(flicked.start).toBe(before.start);
    expect(flicked.end).toBeLessThan(before.end);
    // Back where it was, then the same drag with only its first move
    // delivered: it still ends on the fix under the finger.
    await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: 348 } }));
    await act(async () => handlers.onPanResponderRelease(null, { dx: 20, dy: 0 }));
    await settleRange(s);
    expect(s.screen.range.end).toBe(before.end);
    await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: 348 } }));
    await act(async () => handlers.onPanResponderMove(null, { dx: -5, dy: 0 }));
    await act(async () => handlers.onPanResponderRelease(null, { dx: -20, dy: 0 }));
    await settleRange(s);
    expect(s.screen.range.end).toBe(flicked.end);
    // Android's release carries the finger's own position past the last move.
    await act(async () => handlers.onPanResponderGrant({ nativeEvent: { locationX: 348, pageX: 900 } }));
    await act(async () => handlers.onPanResponderMove({ nativeEvent: { pageX: 895 } }, { dx: -5, dy: 0 }));
    await act(async () => handlers.onPanResponderRelease({ nativeEvent: { pageX: 920 } }, { dx: -5, dy: 0 }));
    await settleRange(s);
    expect(s.screen.range.end).toBe(before.end);
  } finally {
    spy.mockRestore();
    await unmount(s);
  }
});

test('K10: a failed read for a different dog or account cannot reuse the old rows', async () => {
  const { useHistoryDayRows } = require('../src/mapHistory/useHistoryScreen');
  const { startOfToday } = require('../src/tracking/TodayDistance');
  const read = jest.fn(async ({ slaveId }) => {
    if (slaveId !== 4) throw new Error('database is locked');
    return { rows: [{ id: 1, slave_id: 4, time: buildFixture('history-my-route').now }], seed: [], after: { done: true } };
  });
  let result;
  function Probe({ slaveId, owner = 'a' }) {
    result = useHistoryDayRows({ read, subject: 'dog', slaveId, owner, day: startOfToday(buildFixture('history-my-route').now), clock: () => buildFixture('history-my-route').now });
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe slaveId={4} />); });
  expect(result.rows).toHaveLength(1);
  await act(async () => renderer.update(<Probe slaveId={6} owner="b" />));
  expect(result).toMatchObject({ rows: [], version: 0, replayHolds: null, loaded: false, error: 'database is locked' });
  await act(async () => renderer.unmount());
});
