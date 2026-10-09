import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import ActivityScreen, { periodLabel } from '../src/activity/ActivityScreen';

const M = 60000;
const NOW = new Date(2026, 9, 7, 9, 30, 40).getTime();
const FIRST = new Date(2026, 8, 1).getTime();

let renderer, onBack;
beforeEach(() => {
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    onBack = callback;
    return { remove: jest.fn() };
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
});

const flatten = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  return flatten(node.children);
};
const text = id => flatten(renderer.root.findAll(node => node.props.testID === id)[0]);
const press = async id => {
  const node = renderer.root.findAll(item => item.props.testID === id && typeof item.props.onPress === 'function')[0];
  await act(async () => node.props.onPress());
};

// Two readings a minute from FIRST: rests at night, otherwise 0.3.
function reader() {
  const calls = [];
  const read = jest.fn(async (slaveId, { start, end, detail }) => {
    calls.push({ start, end, detail });
    if (detail === 'raw') {
      const local = [];
      for (let t = Math.max(start - 9 * M, FIRST); t < Math.min(end + 9 * M, NOW); t += M) {
        local.push({ time: t + 10000, activity: new Date(t).getHours() < 6 ? 0.02 : 0.3, activity_valid: 1,
          slave_id: slaveId, master_id: 7 });
      }
      return { local, cloud: [] };
    }
    const minutes = [];
    for (let t = Math.max(start - 9 * M, FIRST); t < Math.min(end + 9 * M, NOW - 40000); t += M) {
      minutes.push({ minute: t, value: new Date(t).getHours() < 6 ? 0.02 : 0.3, count: 1 });
    }
    return { minutes };
  });
  return { read, calls, readEarliest: jest.fn(async () => FIRST) };
}

async function mount(props) {
  await act(async () => {
    renderer = Renderer.create(<ActivityScreen name="小黑" slaveId={6} now={NOW} onBack={jest.fn()} {...props} />);
  });
}

test('opens on 今天: the title, tabs, period, summary and explanation; › is off, the running minute left out', async () => {
  const { read, readEarliest, calls } = reader();
  await mount({ read, readEarliest });
  const all = flatten(renderer.toJSON());
  expect(all).toContain('小黑・活動量');
  expect(all).toContain('日週月年');
  expect(text('activity-period')).toBe('10/7（三）今天');
  expect(all).toContain('今天休息6 小時劇烈0 分');
  expect(all).not.toContain('休息：最近');
  expect(all).not.toContain('0.05');
  expect(all).not.toContain('0.8');
  expect(calls[0]).toMatchObject({ detail: 'raw' });
  const next = renderer.root.findAll(node => node.props.testID === 'activity-next' && node.props.accessibilityState)[0];
  expect(next.props.accessibilityState.disabled).toBe(true);
});

test('‹ › move by the tab\'s period and stop at the first reading; tabs keep the day', async () => {
  const { read, readEarliest } = reader();
  let blockYear = false, releaseYear;
  const controlledRead = (...args) => blockYear ? new Promise(resolve => {
    releaseYear = () => { blockYear = false; resolve(read(...args)); };
  }) : read(...args);
  await mount({ read: controlledRead, readEarliest });
  await press('activity-previous');
  expect(text('activity-period')).toBe('10/6（二）');
  await press('activity-next');
  expect(text('activity-period')).toBe('10/7（三）今天');
  await press('activity-tab-week');
  expect(text('activity-period')).toBe('10/4（日）– 10/10（六）');
  expect(flatten(renderer.toJSON())).toContain('這一週');
  await press('activity-tab-month');
  expect(text('activity-period')).toBe('2026 年 10 月');
  await press('activity-previous');
  expect(text('activity-period')).toBe('2026 年 9 月');
  const previous = () => renderer.root.findAll(node => node.props.testID === 'activity-previous'
    && node.props.accessibilityState)[0].props.accessibilityState.disabled;
  expect(previous()).toBe(true);
  blockYear = true;
  await press('activity-tab-year');
  expect(text('activity-period')).toBe('2026 年');
  // Hold the first year read so loading does not depend on act/timer speed.
  expect(flatten(renderer.toJSON())).not.toContain('載入中…');
  expect(renderer.root.findByType(require('../src/components/Skeleton').LoadingContent).props.loading).toBe(true);
  await act(async () => releaseYear());
  for (let i = 0; i < 20 && !flatten(renderer.toJSON()).includes('這一年'); i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  expect(flatten(renderer.toJSON())).toContain('這一年');
  expect(read.mock.calls.filter(([, period]) => period.detail === 'minute').length).toBeGreaterThan(2);
});

test('the back key returns to the card', async () => {
  const back = jest.fn();
  const { read, readEarliest } = reader();
  await mount({ read, readEarliest, onBack: back });
  expect(onBack()).toBe(true);
  expect(back).toHaveBeenCalledTimes(1);
});

test('載入中 with the period, then 讀取失敗 and 重試 reads again', async () => {
  let fail = true;
  const read = jest.fn(() => (fail ? Promise.reject(new Error('x')) : new Promise(() => {})));
  await mount({ read, readEarliest: async () => FIRST, initialView: { mode: 'week', date: NOW } });
  expect(flatten(renderer.toJSON())).toContain('讀取失敗');
  expect(text('activity-period')).toBe('10/4（日）– 10/10（六）');
  fail = false;
  const retry = renderer.root.findAll(node => node.props.accessibilityLabel === '重試'
    && typeof node.props.onPress === 'function')[0];
  await act(async () => retry.props.onPress());
  expect(read).toHaveBeenCalledTimes(2);
  expect(flatten(renderer.toJSON())).not.toContain('載入中…');
  expect(renderer.root.findByType(require('../src/components/Skeleton').LoadingContent).props.loading).toBe(true);
});

test('沒有活動量資料 for a dog without readings; both arrows off', async () => {
  await mount({ read: async () => ({ local: [], cloud: [] }), readEarliest: async () => null });
  expect(flatten(renderer.toJSON())).toContain('沒有活動量資料');
  const states = ['activity-previous', 'activity-next'].map(id => renderer.root.findAll(node =>
    node.props.testID === id && node.props.accessibilityState)[0].props.accessibilityState.disabled);
  expect(states).toEqual([true, true]);
});

test('day chart exposes one duration summary and the shared four-state legend', async () => {
  const { read, readEarliest } = reader();
  await mount({ read, readEarliest });
  const chart = renderer.root.findAll(node => node.props.testID === 'activity-day-summary')[0];
  expect(chart.props.accessible).toBe(true);
  expect(chart.props.accessibilityLabel).toBe('休息 6 小時，一般 3 小時 30 分');
  expect(flatten(renderer.toJSON())).toContain('休息一般劇烈沒有資料');
  expect(periodLabel('day', NOW, NOW)).toBe('10/7（三）今天');
});

test('a tab switch that lands before the first reading shows the first period with data', async () => {
  const { read } = reader();
  const first = new Date(2026, 8, 16, 8).getTime();
  await mount({ read, readEarliest: async () => first, initialView: { mode: 'month', date: first } });
  expect(text('activity-period')).toBe('2026 年 9 月');
  await press('activity-tab-week');
  expect(text('activity-period')).toBe('9/13（日）– 9/19（六）');
  await press('activity-tab-day');
  expect(text('activity-period')).toBe('9/16（三）');
  expect(flatten(renderer.toJSON())).not.toContain('讀取失敗');
});

test('another reader (account) never shows the old answer; the first reading is read again', async () => {
  const all = reader();
  let first = null;
  const read = jest.fn((...args) => (first == null ? Promise.resolve({ local: [], cloud: [] }) : all.read(...args)));
  const readEarliest = jest.fn(async () => first);
  await mount({ read, readEarliest });
  expect(flatten(renderer.toJSON())).toContain('沒有活動量資料');
  // A new minute: the dog now has readings.
  first = FIRST;
  await act(async () => renderer.update(<ActivityScreen name="小黑" slaveId={6} now={NOW + M} read={read}
    readEarliest={readEarliest} onBack={jest.fn()} />));
  expect(flatten(renderer.toJSON())).not.toContain('沒有活動量資料');
  const pending = jest.fn(() => new Promise(() => {}));
  await act(async () => renderer.update(<ActivityScreen name="小黑" slaveId={6} now={NOW + M} read={pending}
    readEarliest={readEarliest} onBack={jest.fn()} />));
  expect(flatten(renderer.toJSON())).not.toContain('載入中…');
  expect(renderer.root.findByType(require('../src/components/Skeleton').LoadingContent).props.loading).toBe(true);
});

test.each(['light', 'dark'])('day bars use %s tokens, 1dp gaps and rounded tops; missing rows survive empty data', async mode => {
  const { ThemeScope, lightTheme, darkTheme } = require('../src/theme/ThemeProvider');
  const { StyleSheet } = require('react-native');
  const theme = mode === 'light' ? lightTheme : darkTheme;
  const read = async () => ({ minutes: [{ minute: NOW - M - 40000, value: 0.3, count: 1 }] });
  await act(async () => {
    renderer = Renderer.create(<ThemeScope theme={theme}><ActivityScreen name="小黑" slaveId={6}
      now={NOW} read={read} readEarliest={async () => FIRST} onBack={jest.fn()} /></ThemeScope>);
  });
  const chart = renderer.root.findAll(node => node.props.testID === 'activity-day-chart')[0];
  expect(StyleSheet.flatten(chart.props.style).gap).toBe(1);
  const bar = renderer.root.findAll(node => node.props.testID === 'activity-day-bar-37')[0];
  expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ height: 60,
    backgroundColor: theme.colors.activityNormal, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 });
  const gap = renderer.root.findAll(node => node.props.testID === 'activity-day-gap-0')[0];
  expect(StyleSheet.flatten(gap.props.style).backgroundColor).toBe(theme.colors.noDataLine);
  expect(text('activity-row-missing')).toContain('合計');
});
