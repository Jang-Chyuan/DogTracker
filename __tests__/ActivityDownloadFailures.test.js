import { t as i18nT } from '../src/i18n';
// 2026-10-21 bug (PR #248 on the user's phone): A4's 日 of a day only the
// cloud held stayed on 「這天的紀錄還沒下載完」 for good, right after 看軌跡
// had been downloading another day, with the automatic sync running every
// 30 s. Each suspect, with fictional data: what must end with the day shown.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import ActivityScreen from '../src/activity/ActivityScreen';
import { createHistoryCloud, DOWNLOAD_AFTER_MS } from '../src/mapHistory/HistoryCloud';
import { dayBounds } from '../src/history/screen/HistoryScreenDates';

const M = 60000;
const NOW = new Date(2026, 9, 7, 9, 30, 40).getTime();
const FIRST = new Date(2026, 8, 1).getTime();
const DAY = '2026-10-06';
const DATE = new Date(2026, 9, 6, 12).getTime();

let renderer, warn;
beforeEach(() => {
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
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
const wait = ms => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
async function until(check, ms = 3000) {
  for (const start = Date.now(); Date.now() - start < ms;) {
    if (check()) return;
    await wait(10);
  }
}
const shown = () => all().includes('一般') && byId('activity-download').length === 0;

const keyOf = time => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// What A4 reads: 小黑's readings on the days `present` holds.
function reader(present) {
  return jest.fn(async (slaveId, { start, end }) => {
    const local = [];
    for (let t = Math.max(start, FIRST); t < Math.min(end, NOW - 40000); t += M) {
      if (present.has(keyOf(t))) local.push({ time: t + 10000, activity: 0.3, activity_valid: 1, slave_id: slaveId, master_id: 7 });
    }
    return { local, cloud: [] };
  });
}

// The real HistoryCloud adapter over a stand-in Supabase and database, with
// the sync's exclusive slot like IndependentCloudSync.runManual: refused while
// another manual download holds it (c585), and 「下載已取消」 (c576) when the
// sync is not ready (`notReady` times).
function realCloud({ present, count = { cloud: 14000, local: 0 }, countError = null, notReady = 0, holdFirst = false }) {
  const proofs = [];
  const client = { from: () => {
    const log = [];
    const q = {};
    for (const name of ['select', 'eq', 'gte', 'lt', 'gt', 'or', 'order', 'limit', 'in']) {
      q[name] = (...args) => { log.push([name, ...args]); return q; };
    }
    q.abortSignal = () => {
      const head = log.some(([name, , options]) => name === 'select' && options?.head);
      if (head) return Promise.resolve(countError ? { count: null, error: countError } : { count: count.cloud, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    return q;
  } };
  const database = {
    initialize: async () => {},
    savePage: async () => {},
    readArchivePublication: async () => ({ cutoff: NOW - 30000, revision: 4 }),
    countSlaveRange: async () => count.local,
    historyDownloadStates: async () => proofs.map(row => ({ ...row })),
    setHistoryDownloadState: async (owner, slaveId, day, complete, coverage = {}) => {
      const index = proofs.findIndex(row => row.slave_id === slaveId && row.day === day);
      if (index >= 0) proofs.splice(index, 1);
      proofs.push({ slave_id: slaveId, day, complete: complete ? 1 : 0, ...coverage });
      if (complete) present.add(day);
    },
  };
  let busy = false, refusals = notReady, release = null;
  const slot = {
    runs: 0,
    async runManual(work, abort) {
      slot.runs += 1;
      if (busy) throw new Error(i18nT('c585'));
      if (refusals > 0) { refusals -= 1; throw new Error(i18nT('c576')); }
      busy = true;
      try {
        if (holdFirst && slot.runs === 1) await new Promise(resolve => { release = resolve; });
        if (abort.signal.aborted) throw new Error(i18nT('c576'));
        return await work(() => !abort.signal.aborted);
      } finally { busy = false; }
    },
    release: () => release?.(),
  };
  const cloud = createHistoryCloud({ client, database, owner: 'owner-a', runManual: slot.runManual });
  return { cloud, slot, proofs };
}

async function mount(cloud, read, props = {}) {
  await act(async () => {
    renderer = Renderer.create(<ActivityScreen name="小黑" slaveId={6} now={NOW} onBack={jest.fn()}
      downloadSettleMs={0} downloadRetryDelays={[20, 40]} read={read} readEarliest={async () => FIRST}
      cloud={cloud} online initialView={{ mode: 'day', date: DATE }} {...props} />);
  });
}

test('the cloud cannot count the day (statement timeout): A4 downloads it anyway, never stuck on c321', async () => {
  const present = new Set();
  const { cloud } = realCloud({ present, countError: { message: 'canceling statement due to statement timeout', code: '57014' } });
  const read = reader(present);
  await mount(cloud, read);
  await until(shown);
  expect(all()).not.toContain(i18nT('c321'));
  expect(shown()).toBe(true);
  expect(warn).toHaveBeenCalledWith('[ActivityDownload] failed', expect.objectContaining({ day: DAY, stage: 'count' }));
});

test('the sync not ready (「下載已取消」 from its slot) twice: retried with a pause, then the day', async () => {
  const present = new Set();
  const { cloud, slot } = realCloud({ present, notReady: 2 });
  await mount(cloud, reader(present));
  await until(shown);
  expect(slot.runs).toBe(3);
  expect(shown()).toBe(true);
  expect(warn).toHaveBeenCalledWith('[ActivityDownload] failed', expect.objectContaining({ day: DAY, stage: 'download' }));
});

test('看軌跡 still downloading 10/18 (another day): A4 waits its turn, then shows the day', async () => {
  const present = new Set();
  const { cloud, slot } = realCloud({ present, holdFirst: true });
  const { dayStart, dayEnd } = dayBounds('2026-10-05');
  const history = cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: NOW });
  await mount(cloud, reader(present));
  await wait(50);
  expect(all()).toContain(i18nT('c155', { date: '10/06' }));
  expect(all()).not.toContain(i18nT('c321'));
  await act(async () => slot.release());
  await history;
  await until(shown);
  expect(shown()).toBe(true);
});

test('a refused slot every time: after its retries the page says c321 with 重試, and 重試 works', async () => {
  const present = new Set();
  const { cloud } = realCloud({ present, notReady: 3 });
  await mount(cloud, reader(present));
  await until(() => all().includes(i18nT('c321')));
  expect(all()).toContain(i18nT('c321'));
  expect(byId('activity-download-retry').length).toBeGreaterThan(0);
  const retry = byId('activity-download-retry').find(node => typeof node.props.onPress === 'function');
  await act(async () => retry.props.onPress());
  await until(shown);
  expect(shown()).toBe(true);
});

test('a re-render mid-download (new publication, the same adapter): the download goes on and the day shows', async () => {
  const present = new Set();
  const { cloud, slot } = realCloud({ present, holdFirst: true });
  const read = reader(present);
  await mount(cloud, read, { revision: 1 });
  await wait(20);
  await act(async () => renderer.update(<ActivityScreen name="小黑" slaveId={6} now={NOW + 20000} onBack={jest.fn()}
    downloadSettleMs={0} downloadRetryDelays={[20, 40]} read={read} readEarliest={async () => FIRST}
    cloud={cloud} online revision={2} initialView={{ mode: 'day', date: DATE }} />));
  await act(async () => slot.release());
  await until(shown);
  expect(shown()).toBe(true);
  expect(all()).not.toContain(i18nT('c321'));
});

test('a day already proven at a cutoff whose coverage ends early still downloads only its tail', async () => {
  // Sanity of the proof the real adapter writes: proven after one download.
  const present = new Set();
  const { cloud, proofs } = realCloud({ present });
  await mount(cloud, reader(present));
  await until(shown);
  const { dayEnd } = dayBounds(DAY);
  expect(proofs).toContainEqual(expect.objectContaining({ slave_id: 6, day: DAY, complete: 1,
    received_before: dayEnd + DOWNLOAD_AFTER_MS }));
});

test('the release log line: the day, the step and the words, nothing that names a place or a person', () => {
  const { activityDownloadDiagnostic } = require('../src/logger');
  activityDownloadDiagnostic({ day: DAY, stage: 'count', error: Object.assign(new Error(
    'canceling statement due to statement timeout https://x.supabase.co/rest/v1?slave_id=eq.108 a@b.tw 1792052725875'), { status: 500 }) });
  expect(warn).toHaveBeenLastCalledWith('[ActivityDownload] failed', { day: DAY, stage: 'count', status: 500,
    message: 'canceling statement due to statement timeout <url> <email> <n>' });
  activityDownloadDiagnostic({ day: 'x', stage: 'nope', error: new Error('y') });
  expect(warn).toHaveBeenCalledTimes(1);
});
