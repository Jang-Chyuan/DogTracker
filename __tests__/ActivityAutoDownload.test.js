import { t as i18nT } from '../src/i18n';
// A4 downloads the cloud days it needs (2026-10-21 user decision): opening
// the page, or going to a day / week / month, downloads the days that are
// neither proven downloaded (history_download_state, as 看軌跡 checks) nor
// already complete on this phone, with HistoryCloud's own download. While
// downloading it shows loading, never 沒有資料. Fictional data only.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import ActivityScreen from '../src/activity/ActivityScreen';
import { periodDays, unprovenDays, withinBudget } from '../src/activity/ActivityDownloads';
import { createHistoryCloud, ARCHIVE_CURRENT_MS, COUNT_KEEP_MS, DOWNLOAD_BEFORE_MS } from '../src/mapHistory/HistoryCloud';
import { dayBounds } from '../src/history/screen/HistoryScreenDates';
import { DOWNLOAD_AFTER_MS } from '../src/mapHistory/HistoryCloud';

const M = 60000;
const NOW = new Date(2026, 9, 7, 9, 30, 40).getTime();
const FIRST = new Date(2026, 8, 1).getTime();
const DAY = '2026-10-06';

let renderer;
beforeEach(() => {
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
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
const all = () => flatten(renderer.toJSON());
const byId = id => renderer.root.findAll(node => node.props.testID === id);
const loading = () => renderer.root.findByType(require('../src/components/Skeleton').LoadingContent).props.loading;
const settle = async (times = 10) => {
  for (let i = 0; i < times; i += 1) await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
};
const press = async id => {
  const node = renderer.root.findAll(item => item.props.testID === id && typeof item.props.onPress === 'function')[0];
  await act(async () => node.props.onPress());
};

// 小黑 (6) on this phone: two readings a minute on the days in `local`; the
// days in `cloudOnly` appear once the stand-in cloud has downloaded them.
function world({ local = [], cloudOnly = [], proven = [], complete = [], hold = false, fail = false, failDownload = false } = {}) {
  const present = new Set(local);
  const downloads = [];
  let release = null;
  const day = time => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const read = jest.fn(async (slaveId, { start, end, detail }) => {
    const rows = [], minutes = [];
    for (let t = Math.max(start, FIRST); t < Math.min(end, NOW - 40000); t += M) {
      if (!present.has(day(t))) continue;
      if (detail === 'raw') rows.push({ time: t + 10000, activity: 0.3, activity_valid: 1, slave_id: slaveId, master_id: 7 });
      else minutes.push({ minute: t, value: 0.3, count: 1 });
    }
    return detail === 'raw' ? { local: rows, cloud: [] } : { minutes };
  });
  const cloud = {
    owner: 'owner-a',
    downloadStates: jest.fn(async () => proven.map(key => {
      const { dayStart, dayEnd } = dayBounds(key);
      return { slave_id: 6, day: key, complete: 1, range_start: dayStart, range_end: dayEnd,
        received_before: dayEnd + DOWNLOAD_AFTER_MS };
    })),
    missingRows: jest.fn(async ({ dayStart }) => {
      if (fail) throw new Error('fixture: 連不上');
      return { missing: !complete.includes(day(dayStart)) };
    }),
    download: jest.fn(({ dayStart, signal }) => {
      downloads.push(day(dayStart));
      if (failDownload) return Promise.reject(new Error('fixture: 下載失敗'));
      return new Promise((resolve, reject) => {
        const finish = () => {
          if (cloudOnly.includes(day(dayStart))) present.add(day(dayStart));
          // HistoryCloud proves a finished day (history_download_state).
          proven.push(day(dayStart));
          resolve(1);
        };
        signal?.addEventListener?.('abort', () => reject(new Error('已取消')));
        if (hold) release = finish; else finish();
      });
    }),
    earliest: jest.fn(async () => FIRST),
  };
  return { read, readEarliest: async () => FIRST, cloud, downloads, release: () => release?.() };
}

async function mount(props) {
  await act(async () => {
    renderer = Renderer.create(<ActivityScreen name="小黑" slaveId={6} now={NOW} onBack={jest.fn()}
      downloadSettleMs={0} {...props} />);
  });
  await settle();
}

test('the days a period asks for: up to now, newest first; a proven day is not asked for again', () => {
  expect(periodDays('day', new Date(2026, 9, 6, 12).getTime(), NOW)).toEqual([DAY]);
  // Week of 10/4 – 10/10 on 10/7: Sunday to today, newest first.
  expect(periodDays('week', NOW, NOW)).toEqual(['2026-10-07', '2026-10-06', '2026-10-05', '2026-10-04']);
  expect(periodDays('month', new Date(2026, 8, 15).getTime(), NOW)).toHaveLength(30);
  const { dayStart, dayEnd } = dayBounds(DAY);
  const states = [{ slave_id: 6, day: DAY, complete: 1, range_start: dayStart, range_end: dayEnd,
    received_before: dayEnd + DOWNLOAD_AFTER_MS }];
  expect(unprovenDays(['2026-10-07', DAY, '2026-10-05'], states, { slaveId: 6, cutoff: NOW, serverOffset: 0 }))
    .toEqual(['2026-10-07', '2026-10-05']);
  // An incomplete row is not a proof.
  expect(unprovenDays([DAY], [{ ...states[0], complete: 0 }], { slaveId: 6, cutoff: NOW, serverOffset: 0 })).toEqual([DAY]);
});

test('a day only the cloud holds: downloading shows loading (never 沒有資料), then the day', async () => {
  const w = world({ local: [], cloudOnly: [DAY], hold: true });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  expect(w.cloud.download).toHaveBeenCalledTimes(1);
  expect(w.downloads).toEqual([DAY]);
  expect(w.cloud.download.mock.calls[0][0]).toMatchObject({ slaveId: 6, dayStart: dayBounds(DAY).dayStart,
    dayEnd: dayBounds(DAY).dayEnd });
  expect(all()).toContain(i18nT('c155', { date: '10/06' }));
  expect(byId('activity-empty')).toHaveLength(0);
  expect(loading()).toBe(true);
  await act(async () => w.release());
  await settle(20);
  expect(byId('activity-download')).toHaveLength(0);
  expect(loading()).toBe(false);
  expect(byId('activity-empty')).toHaveLength(0);
  expect(all()).toContain('一般');
  // Read again once the download finished.
  expect(w.read.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('a day proven downloaded (as 看軌跡 checks) asks nothing and downloads nothing', async () => {
  const w = world({ local: [DAY], proven: [DAY] });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  expect(w.cloud.downloadStates).toHaveBeenCalled();
  expect(w.cloud.missingRows).not.toHaveBeenCalled();
  expect(w.cloud.download).not.toHaveBeenCalled();
  expect(byId('activity-download')).toHaveLength(0);
});

test('a day this phone already holds in full (the automatic sync) is counted, not downloaded', async () => {
  const w = world({ local: [DAY], complete: [DAY] });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  expect(w.cloud.missingRows).toHaveBeenCalledTimes(1);
  expect(w.cloud.download).not.toHaveBeenCalled();
});

test('offline: a day not downloaded shows the offline words with 重試, not 沒有資料', async () => {
  const w = world({ local: [], cloudOnly: [DAY] });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: false,
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  expect(w.cloud.download).not.toHaveBeenCalled();
  expect(w.cloud.missingRows).not.toHaveBeenCalled();
  expect(all()).toContain(i18nT('c157', { date: '10/06' }));
  expect(byId('activity-empty')).toHaveLength(0);
  // Not a chart of 沒有資料 either: only the words and 重試.
  expect(byId('activity-row-missing')).toHaveLength(0);
  expect(byId('activity-day-chart')).toHaveLength(0);
  expect(byId('activity-download-retry').length).toBeGreaterThan(0);
  // Back online: 重試 downloads it.
  await act(async () => renderer.update(<ActivityScreen name="小黑" slaveId={6} now={NOW} onBack={jest.fn()}
    downloadSettleMs={0} read={w.read} readEarliest={w.readEarliest} cloud={w.cloud} online
    initialView={{ mode: 'day', date: new Date(2026, 9, 6, 12).getTime() }} />));
  await settle(20);
  expect(w.cloud.download).toHaveBeenCalledTimes(1);
});

test('a count that fails only saves nothing: the day is downloaded anyway', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const w = world({ local: [], cloudOnly: [DAY], fail: true });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  await settle(20);
  expect(w.cloud.download).toHaveBeenCalledTimes(1);
  expect(byId('activity-empty')).toHaveLength(0);
  expect(all()).toContain('一般');
});

test('a download that keeps failing: retried, then c321 with 重試; 重試 starts again', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const w = world({ local: [], cloudOnly: [DAY], failDownload: true });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true, downloadRetryDelays: [1, 1],
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  await settle(20);
  expect(w.cloud.download).toHaveBeenCalledTimes(3);
  expect(all()).toContain(i18nT('c321'));
  expect(byId('activity-empty')).toHaveLength(0);
  expect(byId('activity-download-retry').length).toBeGreaterThan(0);
  await press('activity-download-retry');
  await settle(20);
  expect(w.cloud.download).toHaveBeenCalledTimes(6);
});

test('not signed in (no cloud): nothing is asked or downloaded, 沒有資料 as before', async () => {
  const w = world({ local: [], cloudOnly: [DAY] });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: null, online: true,
    initialView: { mode: 'day', date: new Date(2026, 9, 6, 12).getTime() } });
  expect(w.cloud.downloadStates).not.toHaveBeenCalled();
  expect(byId('activity-download')).toHaveLength(0);
  expect(byId('activity-empty').length).toBeGreaterThan(0);
});

test('week: only the missing days are downloaded, newest first, with progress', async () => {
  // 10/4 – 10/7: 10/6 proven, 10/5 complete here, 10/7 and 10/4 missing.
  const w = world({ local: ['2026-10-05', '2026-10-06'], cloudOnly: ['2026-10-04', '2026-10-07'],
    proven: [DAY], complete: ['2026-10-05'], hold: true });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'week', date: NOW } });
  expect(w.cloud.missingRows.mock.calls.map(([q]) => q.dayStart))
    .toEqual(['2026-10-07', '2026-10-05', '2026-10-04'].map(key => dayBounds(key).dayStart));
  expect(w.downloads).toEqual(['2026-10-07']);
  expect(all()).toContain(i18nT('c1440', { done: 0, total: 2 }));
  // Partial data stays on screen while the rest downloads; the days still
  // coming are a skeleton, not 沒有資料.
  expect(loading()).toBe(false);
  expect(byId('activity-empty')).toHaveLength(0);
  const start = key => dayBounds(key).dayStart;
  expect(byId(`activity-waiting-${start('2026-10-04')}`).length).toBeGreaterThan(0);
  expect(byId(`activity-nodata-${start('2026-10-04')}`)).toHaveLength(0);
  expect(byId('activity-row-missing')).toHaveLength(0);
  await act(async () => w.release());
  await settle();
  expect(w.downloads).toEqual(['2026-10-07', '2026-10-04']);
  expect(all()).toContain(i18nT('c1440', { done: 1, total: 2 }));
  await act(async () => w.release());
  await settle(20);
  expect(byId('activity-download')).toHaveLength(0);
});

test('取消 stops the downloads; the page keeps what it has and offers 重試', async () => {
  const w = world({ local: [DAY], cloudOnly: ['2026-10-07', '2026-10-05'], hold: true });
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'week', date: NOW } });
  expect(w.downloads).toEqual(['2026-10-07']);
  await press('activity-download-cancel');
  await settle();
  expect(w.downloads).toEqual(['2026-10-07']);
  expect(all()).toContain(i18nT('c686'));
  expect(byId('activity-download-retry').length).toBeGreaterThan(0);
});

test('the settle before asking: 沒有資料 is not shown while the plan has not answered', async () => {
  const w = world({ local: [], cloudOnly: [DAY] });
  await act(async () => {
    renderer = Renderer.create(<ActivityScreen name="小黑" slaveId={6} now={NOW} onBack={jest.fn()}
      downloadSettleMs={60000} read={w.read} readEarliest={w.readEarliest} cloud={w.cloud} online
      initialView={{ mode: 'day', date: new Date(2026, 9, 6, 12).getTime() }} />);
  });
  await settle();
  expect(w.cloud.downloadStates).not.toHaveBeenCalled();
  expect(byId('activity-empty')).toHaveLength(0);
  expect(loading()).toBe(true);
});

test('年 downloads nothing: it finds the months with rows missing and says so', async () => {
  const w = world({ local: ['2026-10-06'] });
  w.cloud.missingRows.mockImplementation(async ({ dayStart }) => ({ missing: new Date(dayStart).getMonth() === 8 }));
  await mount({ read: w.read, readEarliest: w.readEarliest, cloud: w.cloud, online: true,
    initialView: { mode: 'year', date: NOW } });
  await settle(20);
  // 10 months asked (January to October), none downloaded.
  expect(w.cloud.missingRows).toHaveBeenCalledTimes(10);
  expect(w.cloud.download).not.toHaveBeenCalled();
  expect(all()).toContain(i18nT('c686'));
  expect(all()).toContain(i18nT('c1442'));
});

test('one plan downloads at most its row budget, newest first (the first day always)', () => {
  const days = ['2026-10-07', '2026-10-06', '2026-10-05'];
  const counts = { '2026-10-07': 14000, '2026-10-06': 14000, '2026-10-05': 14000 };
  expect(withinBudget(days, counts, 30000)).toEqual(['2026-10-07', '2026-10-06']);
  expect(withinBudget(days, counts, 1000)).toEqual(['2026-10-07']);
});

// HistoryCloud.missingRows over a stand-in Supabase client and database.
function countingCloud({ cloudCount, localCount, archived = null }) {
  const asked = [];
  const client = { from: table => {
    const log = [['from', table]];
    asked.push(log);
    const q = {};
    for (const name of ['select', 'eq', 'gte', 'lt']) q[name] = (...args) => { log.push([name, ...args]); return q; };
    q.abortSignal = () => Promise.resolve({ count: cloudCount, error: null });
    return q;
  } };
  const database = {
    countSlaveRange: jest.fn(async () => localCount),
    readArchivePublication: jest.fn(async () => (archived == null ? null : { cutoff: archived, revision: 3 })),
  };
  return { cloud: createHistoryCloud({ client, database, owner: 'owner-a' }), asked, database };
}

test('missingRows: one head count of the download\'s window against this phone\'s rows', async () => {
  const { dayStart, dayEnd } = dayBounds(DAY);
  const { cloud, asked, database } = countingCloud({ cloudCount: 14000, localCount: 9000 });
  const answer = await cloud.missingRows({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0, at: NOW });
  expect(answer).toEqual({ missing: true, cloud: 14000, local: 9000 });
  expect(asked[0]).toEqual([['from', 'dog_telemetry'], ['select', 'event_id', { count: 'exact', head: true }],
    ['eq', 'slave_id', 6], ['gte', 'received_at', new Date(dayStart - DOWNLOAD_BEFORE_MS).toISOString()],
    ['lt', 'received_at', new Date(dayEnd + DOWNLOAD_AFTER_MS).toISOString()]]);
  expect(database.countSlaveRange).toHaveBeenCalledWith('owner-a', 6, dayStart - DOWNLOAD_BEFORE_MS, dayEnd + DOWNLOAD_AFTER_MS);
  // A closed window is not asked again for a while; then it is (late Master uploads).
  await cloud.missingRows({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0, at: NOW + 1000 });
  expect(asked).toHaveLength(1);
  await cloud.missingRows({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0, at: NOW + COUNT_KEEP_MS });
  expect(asked).toHaveLength(2);
  const same = countingCloud({ cloudCount: 14000, localCount: 14000 });
  expect((await same.cloud.missingRows({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0 })).missing).toBe(false);
});

test('missingRows today: a current archive owns what came after its cutoff; one far behind proves nothing', async () => {
  const { dayStart, dayEnd } = dayBounds('2026-10-07');
  const fresh = countingCloud({ cloudCount: 100, localCount: 100, archived: NOW - 30000 });
  await fresh.cloud.missingRows({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0 });
  expect(fresh.asked[0]).toContainEqual(['lt', 'received_at', new Date(NOW - 30000).toISOString()]);
  const behind = countingCloud({ cloudCount: 100, localCount: 40, archived: NOW - ARCHIVE_CURRENT_MS - 60000 });
  const answer = await behind.cloud.missingRows({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0 });
  expect(behind.asked[0]).toContainEqual(['lt', 'received_at', new Date(NOW).toISOString()]);
  expect(answer.missing).toBe(true);
});
