import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';
import HistorySheet, { historySummary, shortRangeLabel } from '../src/mapHistory/HistorySheet';
import { HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';

const SINCE = Date.parse('2026-09-17T09:00:00Z');
const UNTIL = Date.parse('2026-09-18T09:00:00Z');
const data = (extra = {}) => ({
  since: SINCE, until: UNTIL,
  phone: { count: 12, segments: [], limited: false },
  clients: [{ slaveId: 4, count: 340, segments: [], limited: false }],
  coverage: { source: 'cloud', rows: 340, from: SINCE + 3600000 },
  ...extra,
});
const history = (extra = {}) => ({
  preferences: { ...HISTORY_DEFAULTS, masters: [7], slaves: [4], hours: 3 },
  // What this phone holds: the card offers these instead of asking for typed
  // device numbers.
  devices: [{ master: 5, slave: 4 }, { master: 7, slave: 4 }, { master: 3, slave: 6 }],
  data: data(), error: '', busy: false, key: 'k', save: jest.fn(), ...extra,
});

let renderer;
const flatten = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  return flatten(node.children);
};
const cardText = () => flatten(renderer.toJSON());
const control = label => renderer.root.findAll(
  node => node.props.accessibilityLabel === label &&
    (typeof node.props.onPress === 'function' || typeof node.props.onChangeText === 'function'),
  { deep: false })[0];

async function mount(value) {
  await act(async () => {
    renderer = Renderer.create(<HistorySheet history={value} snapshot={{ current: null }}
      bottomInset={80} topInset={100} onHeight={() => {}} />);
  });
  // The card starts collapsed; its controls exist once it is expanded.
  await act(async () => renderer.root
    .findAllByProps({ testID: 'history-sheet-handle' })[0]
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
});

test('the card header says which window is drawn and how many rows it holds', () => {
  expect(historySummary(history())).toContain('手機 12 筆 · 狗 4 340 筆');
  expect(historySummary(history({ data: null }))).toBe('正在讀取歷史軌跡…');
  expect(historySummary(history({ error: '讀取失敗' }))).toBe('讀取失敗');
});

test('dogs and Masters are multi-select, picked from what the phone holds', async () => {
  const value = history();
  await mount(value);
  // The sections start folded, so the card is about a screen high.
  expect(control('狗 4')).toBeUndefined();
  await act(async () => control('狗與 Master').props.onPress());
  expect(control('狗 4')).toBeDefined();
  expect(control('狗 6')).toBeDefined();
  // No typing device numbers: both ids can take several values, and a number
  // that exists nowhere looks exactly like "no data".
  await act(async () => control('狗 6').props.onPress());
  expect(control('狗 4').props.accessibilityState.selected).toBe(true);
  expect(control('狗 6').props.accessibilityState.selected).toBe(true);
  await act(async () => control('Master 5').props.onPress());
  await act(async () => control('時間').props.onPress());
  await act(async () => control('過去 6 小時').props.onPress());
  expect(value.save).not.toHaveBeenCalled();
  await act(async () => control('套用（有未套用的變更）').props.onPress());
  expect(value.save).toHaveBeenCalledWith(expect.objectContaining({
    slaves: [4, 6], masters: [5, 7], hours: 6,
  }));
});

test('what is being edited drives the devices and days, before it is applied', async () => {
  const preview = jest.fn();
  const value = history({ preview });
  await mount(value);
  await act(async () => control('資料來源').props.onPress());
  await act(async () => control('雲端下載的（Supabase）').props.onPress());
  // Without this the dog and Master chips still list the other source's
  // devices until 套用 is pressed.
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ source: 'cloud' }));
  await act(async () => control('狗與 Master').props.onPress());
  await act(async () => control('狗 6').props.onPress());
  // And the dogs being picked, so the day list is not answered for the pair
  // that was applied before.
  expect(preview).toHaveBeenLastCalledWith(
    { source: 'cloud', masters: [7], slaves: [4, 6] });
});

test('a source with nothing downloaded says so instead of offering numbers', async () => {
  await mount(history({ devices: [] }));
  await act(async () => control('狗與 Master').props.onPress());
  expect(cardText()).toContain('這支手機還沒有這個來源的資料');
});

test('the card states the range it will query, and no stale coverage warning', async () => {
  await mount(history());
  // The card downloads a cloud range it does not hold, so a warning telling
  // someone to go and fetch it themselves no longer describes what happens.
  expect(cardText()).not.toContain('本機雲端副本最早只到');
  await act(async () => control('時間').props.onPress());
  expect(cardText()).toContain('會查：');
});

test('export waits for data and stays inside the card', async () => {
  await mount(history({ data: null }));
  expect(control('匯出').props.disabled).toBe(true);
  await act(async () => renderer.unmount());
  await mount(history());
  expect(control('匯出').props.disabled).toBe(false);
});

test('a fixed range is picked from the days that hold rows, then fine-tuned', async () => {
  const day = new Date(2026, 8, 18).getTime();
  const value = history({
    days: [{ day, rows: 1203, from: day + 9 * 3600000, to: day + 22 * 3600000 }],
  });
  await mount(value);
  await act(async () => control('時間').props.onPress());
  // Presets only: nothing to type, and nothing that needs validating.
  expect(control('過去 3 小時')).toBeDefined();
  expect(cardText()).not.toContain('自己輸入');
  await act(async () => control('指定起訖').props.onPress());
  // Which days actually hold rows is shown before anything is queried.
  expect(control('9/18（1203 筆）')).toBeDefined();
  await act(async () => control('9/18（1203 筆）').props.onPress());
  expect(cardText()).toContain('會查：');

  // The platform picker does the picking: date first, then time.
  await act(async () => control('選擇開始時間').props.onPress());
  const picker = () => renderer.root.findAllByProps({ testID: 'history-datetime-picker' })[0];
  expect(picker().props.mode).toBe('date');
  expect(picker().props.minimumDate.getTime()).toBe(day + 9 * 3600000);
  expect(picker().props.maximumDate.getTime()).toBe(day + 22 * 3600000);
  await act(async () => picker().props.onChange({ type: 'set' }, new Date(day)));
  expect(picker().props.mode).toBe('time');
  await act(async () => picker().props.onChange({ type: 'set' },
    new Date(day + 10 * 3600000)));
  expect(renderer.root.findAllByProps({ testID: 'history-datetime-picker' })).toHaveLength(0);
  await act(async () => control('套用（有未套用的變更）').props.onPress());
  expect(value.save).toHaveBeenCalledWith(expect.objectContaining({
    timeMode: 'fixed', startAt: day + 10 * 3600000,
  }));
});

test('a dismissed picker changes nothing', async () => {
  const day = new Date(2026, 8, 18).getTime();
  const value = history({ days: [{ day, rows: 5, from: day, to: day + 3600000 }] });
  await mount(value);
  await act(async () => control('時間').props.onPress());
  await act(async () => control('指定起訖').props.onPress());
  const before = cardText();
  await act(async () => control('選擇結束時間').props.onPress());
  await act(async () => renderer.root
    .findAllByProps({ testID: 'history-datetime-picker' })[0]
    .props.onChange({ type: 'dismissed' }, undefined));
  expect(renderer.root.findAllByProps({ testID: 'history-datetime-picker' })).toHaveLength(0);
  expect(cardText()).toBe(before);
});

test('the pill over the map states the range, not a duration it no longer has', () => {
  const start = new Date(2026, 8, 19, 9, 0).getTime();
  expect(shortRangeLabel({ ...HISTORY_DEFAULTS, hours: 6 })).toBe('過去 6 小時');
  const pill = shortRangeLabel({ ...HISTORY_DEFAULTS, timeMode: 'fixed',
    startAt: start, endAt: start + 3600000 });
  expect(pill).toBe('9/19 09:00–9/19 10:00');
  // The only character that may sit outside ASCII is the en dash: ICU put a
  // thin space between the date and the time on Linux and a plain one on
  // macOS, so this test passed locally and failed in CI on the same commit.
  expect([...pill].filter(c => c.codePointAt(0) > 0x7f)).toEqual(['–']);
});

test('a long history offers the newest days only, the rest through the picker', async () => {
  const DAY = 24 * 3600000;
  const first = new Date(2026, 8, 18).getTime();
  const days = Array.from({ length: 10 }, (_, index) => ({
    day: first - index * DAY, rows: 100 + index,
    from: first - index * DAY + 3600000, to: first - index * DAY + 7200000,
  }));
  await mount(history({ days }));
  await act(async () => control('時間').props.onPress());
  await act(async () => control('指定起訖').props.onPress());
  const chips = renderer.root.findAll(
    node => node.props.accessibilityLabel?.includes('筆）'), { deep: false });
  // Ten days of outings would be a wall of chips.
  expect(chips).toHaveLength(6);
  expect(cardText()).toContain('更早還有 4 天');
  // The picker still reaches every day that holds rows.
  await act(async () => control('選擇開始時間').props.onPress());
  const picker = renderer.root.findAllByProps({ testID: 'history-datetime-picker' })[0];
  expect(picker.props.minimumDate.getTime()).toBe(days[9].from);
  expect(picker.props.maximumDate.getTime()).toBe(days[0].to);
});

test('switching source drops devices the new source does not have', async () => {
  const value = history({
    preferences: { ...HISTORY_DEFAULTS, slaves: [4, 6], masters: [5, 7] },
    devices: [{ master: 5, slave: 4 }, { master: 7, slave: 4 }, { master: 3, slave: 6 }],
  });
  await mount(value);
  // Opening the card is not a change: the saved query is still the saved query.
  expect(control('重新查詢')).toBeDefined();
  await act(async () => control('資料來源').props.onPress());
  await act(async () => control('雲端下載的（Supabase）').props.onPress());
  // The cloud only knows dog 4 here, so dog 6 cannot stay selected: it would
  // return nothing and look like missing data.
  await act(async () => renderer.update(
    <HistorySheet history={{ ...value, devices: [{ master: 5, slave: 4 }] }}
      snapshot={{ current: null }} bottomInset={80} topInset={100} onHeight={() => {}} />));
  await act(async () => control('套用（有未套用的變更）').props.onPress());
  expect(value.save).toHaveBeenCalledWith(expect.objectContaining({
    source: 'cloud', slaves: [4], masters: [5],
  }));
});

test('the phone track is only offered when this phone has recorded one', async () => {
  await mount(history({ phoneRecorded: false }));
  expect(control('隱藏手機軌跡的位置')).toBeUndefined();
  expect(cardText()).toContain('這支手機沒有自己的定位記錄');
  await act(async () => renderer.unmount());
  await mount(history({ phoneRecorded: true }));
  expect(control('隱藏手機軌跡的位置')).toBeDefined();
});

test('a walk the cloud cut short is said so, not shown as "nothing older"', async () => {
  const day = new Date(2026, 8, 18).getTime();
  await mount(history({
    days: [{ day, rows: 12, from: day, to: day + 3600000 }],
    daysIncomplete: 'canceling statement due to statement timeout',
  }));
  await act(async () => control('時間').props.onPress());
  await act(async () => control('指定起訖').props.onPress());
  // Three chips because the cloud stopped answering reads exactly like three
  // days of data, which is how a timeout hid two days that do exist.
  expect(cardText()).toContain('更早的日子沒問完');
  expect(cardText()).toContain('statement timeout');
});

test('a cloud range this phone does not hold downloads itself, once', async () => {
  const day = new Date(2026, 8, 17).getTime();
  const download = { run: jest.fn(), cancel: jest.fn(), busy: false, message: '' };
  const empty = data({ clients: [{ slaveId: 4, count: 0, segments: [], limited: false }] });
  const value = history({
    preferences: { ...HISTORY_DEFAULTS, source: 'cloud', masters: [5, 7], slaves: [4],
      timeMode: 'fixed', startAt: day, endAt: day + 86400000 },
    data: empty,
  });
  await act(async () => {
    renderer = Renderer.create(<HistorySheet history={value} download={download}
      snapshot={{ current: null }} bottomInset={80} topInset={100} onHeight={() => {}} />);
  });
  // Sending someone to 設定 → 雲端資料 to type the same dates, then back here to
  // ask again, is a detour for something the card can do itself.
  expect(download.run).toHaveBeenCalledWith({
    startAt: day, endAt: day + 86400000, masters: [5, 7],
  });
  // The same applied query must not download again on every map refresh.
  await act(async () => renderer.update(<HistorySheet history={{ ...value }} download={download}
    snapshot={{ current: null }} bottomInset={80} topInset={100} onHeight={() => {}} />));
  expect(download.run).toHaveBeenCalledTimes(1);
});

test('a range the phone already holds, or a local source, downloads nothing', async () => {
  const day = new Date(2026, 8, 17).getTime();
  const download = { run: jest.fn(), cancel: jest.fn(), busy: false, message: '' };
  const fixed = { timeMode: 'fixed', startAt: day, endAt: day + 86400000 };
  for (const preferences of [
    { ...HISTORY_DEFAULTS, source: 'cloud', ...fixed },            // rows already here
    { ...HISTORY_DEFAULTS, source: 'ble', ...fixed },              // this phone's own data
    { ...HISTORY_DEFAULTS, source: 'cloud', timeMode: 'recent' },  // a rolling window
  ]) {
    await act(async () => {
      renderer = Renderer.create(<HistorySheet history={history({ preferences })}
        download={download} snapshot={{ current: null }} bottomInset={80} topInset={100}
        onHeight={() => {}} />);
    });
    await act(async () => renderer.unmount());
  }
  renderer = null;
  expect(download.run).not.toHaveBeenCalled();
});

test('the card says it is still asking the cloud which days it holds', async () => {
  const day = new Date(2026, 8, 18).getTime();
  await mount(history({
    days: [{ day, rows: 12, from: day, to: day + 3600000 }], daysLoading: true,
  }));
  await act(async () => control('時間').props.onPress());
  await act(async () => control('指定起訖').props.onPress());
  // The cloud counts are one request per day: without this the chips quietly
  // grew a moment later and the list looked unreliable.
  expect(cardText()).toContain('正在問雲端還有哪幾天');
  expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
});

test('the cloud is only asked for days once that section is open', async () => {
  const wantDays = jest.fn();
  await mount(history({ wantDays }));
  // Entering the tab should not spend requests nobody asked for.
  expect(wantDays).toHaveBeenLastCalledWith(false);
  await act(async () => control('時間').props.onPress());
  await act(async () => control('指定起訖').props.onPress());
  expect(wantDays).toHaveBeenLastCalledWith(true);
  await act(async () => control('往前算一段時間').props.onPress());
  expect(wantDays).toHaveBeenLastCalledWith(false);
});
