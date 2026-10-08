import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { applyScreenFixture, buildFixture, FIXTURE_NOW, FIXTURE_PAGES } from '../src/dev/ScreenFixtures';
import { settingsHome, settingsInput } from '../src/settings/SettingsModel';
import { accountPage, signOutDialog, switchDialog } from '../src/settings/AccountModel';
import AccountSettings from '../src/settings/AccountSettings';
import { cloudError, isAuthFailure, isNetworkFailure } from '../src/cloud/CloudErrors';
import { createCloudSync } from '../src/cloud/CloudSync';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { formatClock } from '../src/map/MapFormat';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';

jest.mock('../src/screens/LoginScreen', () => {
  const { Text } = require('react-native');
  return ({ expired, onLater }) => <Text testID="login" onPress={onLater}>
    {`登入 Supabase 帳號${expired ? '・需要重新登入' : ''}`}</Text>;
});

const MINUTE = 60000;

// What App hands S3 for a fixture (the same path as the settings pages).
function input(name, page = null) {
  const fixture = buildFixture(name, FIXTURE_NOW, page);
  const live = {
    tracking: { mode: 'real', point: {}, route: emptyLiveRoute(), positionSamples: [], ready: { real: true },
      errors: {}, initialSnapshotReady: true, foreground: true,
      preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES } },
    phone: { enabled: true }, cloudDogs: { rows: [] }, cloudSync: { ownerId: 'real' },
    history: { key: 'live', preferences: { source: 'local', dogAliases: {} }, save: jest.fn() },
    dogAvatars: { avatars: {}, save: jest.fn() }, upload: { settings: [], counts: [] },
  };
  const inputs = applyScreenFixture(fixture, live);
  return { fixture, inputs, data: settingsInput(inputs, { now: fixture.now, receiverState: fixture.receiverState }) };
}
const accountRow = data => settingsHome(data).groups[1].rows[0];
const text = renderer => JSON.stringify(renderer.toJSON());
const pressable = (renderer, label) => renderer.root.findAll(node => node.props.accessibilityLabel === label
  && typeof node.props.onPress === 'function')[0];

// ---- fixtures -----------------------------------------------------------------

test('every S3 fixture opens on the account page; any fixture can (&page=cloud)', () => {
  expect(FIXTURE_PAGES).toContain('cloud');
  for (const name of ['cloud-signed-out', 'cloud-ok', 'cloud-upload-pending', 'cloud-unreachable-retrying',
    'cloud-expired', 'upload-switch-confirm', 'upload-switch-offline']) {
    expect(buildFixture(name).openRoute).toBe('cloud');
  }
  expect(buildFixture('cloud-failing').openRoute).toBeNull();
  expect(buildFixture('cloud-failing', FIXTURE_NOW, 'cloud').openRoute).toBe('cloud');
});

test('cloud-signed-out: the sign-in form, no 「!」 (not signed in is a choice)', () => {
  const { data } = input('cloud-signed-out');
  expect(accountPage(data)).toEqual({ signedIn: false, expired: false });
  expect(accountRow(data)).toMatchObject({ subtitle: '未登入', problem: false });
});

test('cloud-ok: signed in, last download, nothing waiting, receiver 7 uploads through this phone', () => {
  const { data } = input('cloud-ok');
  const page = accountPage(data);
  expect(page).toMatchObject({ signedIn: true, email: 'tim@example.com', offline: false, routesLoading: false });
  expect(page.download).toMatchObject({ title: '最後下載成功', right: formatClock(FIXTURE_NOW - 5000), problem: false });
  expect(page.upload).toMatchObject({ problem: null, pendingText: '0 筆', lastText: formatClock(FIXTURE_NOW - 8000) });
  expect(page.routes).toEqual([expect.objectContaining({ master: 7, title: '接收器 7 的上傳方式',
    detail: '由這支手機上傳', mode: 'phone', to: 'wifi', canSwitch: true })]);
  expect(accountRow(data)).toMatchObject({ problem: false, status: ['已登入'] });
});

test('cloud-failing on S3 (as the mockup): 下載失敗 since when + 重試, 12 waiting, last upload', () => {
  const { data } = input('cloud-failing', 'cloud');
  const page = accountPage(data);
  expect(page.download).toEqual({ title: '下載失敗', detail: `連不上 Supabase・${formatClock(FIXTURE_NOW - 6 * MINUTE)} 起`,
    right: null, problem: true, retry: true, label: expect.stringContaining('下載失敗') });
  expect(page.upload).toMatchObject({ problem: null, pendingText: '12 筆', lastText: formatClock(FIXTURE_NOW - 16 * MINUTE) });
  expect(page.offline).toBe(true);
  expect(accountRow(data)).toMatchObject({ problem: true, label: 'Supabase 帳號，有問題：連不上' });
});

test('cloud-upload-pending: 需處理 with 「!」 + 重試, 還沒上傳 12 筆; the gear and S1 count it', () => {
  const { data, inputs } = input('cloud-upload-pending');
  const page = accountPage(data);
  expect(page.download.problem).toBe(false);
  expect(page.upload.problem).toMatchObject({ title: '需處理', right: '3 筆', problem: true, retry: true });
  expect(page.upload.pendingText).toBe('12 筆');
  expect(inputs.cloudProblem).toBe(true);
  expect(accountRow(data).problem).toBe(true);
});

test('cloud-unreachable-retrying: never reached Supabase since start → 「暫時連不上，會自動重試」', () => {
  const { data } = input('cloud-unreachable-retrying');
  const page = accountPage(data);
  expect(page.download).toMatchObject({ title: '暫時連不上，會自動重試', problem: true, retry: true,
    detail: `連不上 Supabase・${formatClock(FIXTURE_NOW - 3 * MINUTE)} 起` });
  expect(page.upload.pendingText).toBe('4 筆');
});

test('cloud-expired: signed out with 需要重新登入; S1 and the gear say so', () => {
  const { data, inputs } = input('cloud-expired');
  expect(accountPage(data)).toEqual({ signedIn: false, expired: true });
  expect(inputs.signInExpired).toBe(true);
  expect(accountRow(data)).toMatchObject({ problem: true, label: 'Supabase 帳號，有問題：需要重新登入' });
});

test('upload-switch-confirm: receiver 7 by Wi-Fi with 120 waiting, the confirmation open (c255)', async () => {
  const { fixture, data } = input('upload-switch-confirm');
  const page = accountPage(data);
  const route = page.routes[0];
  expect(route).toMatchObject({ master: 7, detail: '由接收器的 Wi-Fi 上傳', to: 'phone', pending: 120 });
  expect(fixture.dialog).toEqual({ kind: 'switch', master: 7 });
  expect(switchDialog(route, { offline: page.offline })).toEqual({ title: '改由這支手機上傳？',
    body: '這台接收器改由這支手機上傳。手機裡還有 120 筆沒上傳，會先上傳。', blockedBy: null, confirm: '切換' });
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={page} dialog={fixture.dialog}
    onSwitch={fixture.upload.switchMode} />); });
  expect(text(renderer)).toContain('這台接收器改由這支手機上傳。手機裡還有 120 筆沒上傳，會先上傳。');
  await act(async () => pressable(renderer, '切換').props.onPress());
  expect(renderer.root.findAll(node => node.props.testID === 'upload-switch-dialog' && node.props.visible === true)).toHaveLength(0);
  expect(text(renderer)).not.toContain('會先上傳');
  await act(async () => renderer.unmount());
});

test('upload-switch-offline: it cannot switch without a network (c256)', () => {
  const { data } = input('upload-switch-offline');
  const page = accountPage(data);
  expect(page.offline).toBe(true);
  expect(switchDialog(page.routes[0], { offline: page.offline }).blockedBy).toBe('要先上傳完 120 筆，請連上網路');
});

// ---- the model ----------------------------------------------------------------

test('download before the first pass says 下載中…; switching back to Wi-Fi needs no network when nothing waits', () => {
  const page = accountPage({ account: { signedIn: true, email: 'a@b' }, sync: { ownerId: 'a' },
    upload: { supported: true, settingsReady: true, masters: [], settings: [{ master_id: 5, mode: 'phone' }],
      counts: [], error: '' } });
  expect(page.download).toMatchObject({ right: '下載中…', problem: false });
  expect(page.upload.lastText).toBe('還沒有');
  // Not authorized for 5 any more: going back to Wi-Fi is still allowed.
  expect(page.routes[0]).toMatchObject({ master: 5, canSwitch: true, to: 'wifi', pending: 0 });
  expect(switchDialog(page.routes[0], { offline: true })).toEqual({ title: '改由接收器的 Wi-Fi 上傳？',
    body: '這台接收器改由它自己的 Wi-Fi 上傳，這支手機不再上傳它的資料。', blockedBy: null, confirm: '切換' });
});

test('an unauthorized receiver cannot be switched to this phone; an upload error reads in field words', () => {
  const page = accountPage({ account: { signedIn: true }, sync: {},
    upload: { supported: true, settingsReady: true, masters: [], settings: [{ master_id: 9, mode: 'wifi' }],
      counts: [{ status: 'pending', count: 2 }], error: 'Network request failed' } });
  expect(page.routes[0]).toMatchObject({ canSwitch: false });
  expect(page.upload.problem).toMatchObject({ title: '上傳失敗', detail: '連不上 Supabase', problem: true });
  expect(page.offline).toBe(true);
  const loading = accountPage({ account: { signedIn: true }, sync: {}, upload: { supported: true, settingsReady: false } });
  expect(loading).toMatchObject({ routes: [], routesLoading: true });
});

test('signing out says what stops and what stays', () => {
  expect(signOutDialog(0).body).toBe('登出後會停止背景同步，並解除這支手機的上傳綁定（不再替接收器上傳）。手機裡的資料不會刪除。');
  expect(signOutDialog(12).body).toContain('還有 12 筆沒上傳，再登入這個帳號時會繼續上傳。');
});

// ---- the page -----------------------------------------------------------------

test('S3 rows in the mockup order; 重試 and 登出 (confirmed) reach their handlers', async () => {
  const { data } = input('cloud-failing', 'cloud');
  const retryDownload = jest.fn(), signOut = jest.fn(async () => {});
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={accountPage(data)}
    onRetryDownload={retryDownload} onSignOut={signOut} onSwitch={jest.fn()} />); });
  const ids = renderer.root.findAll(node => typeof node.props.testID === 'string'
    && node.props.testID.startsWith('account-') && node.props.accessibilityLabel).map(node => node.props.testID)
    .filter((id, index, all) => all.indexOf(id) === index);
  expect(ids).toEqual(['account-signed-in', 'account-sign-out', 'account-download', 'account-upload-pending',
    'account-upload-last', 'account-route-7']);
  for (const words of ['tim@example.com', '已登入', '下載', '下載失敗', '重試 ›', '上傳', '還沒上傳', '12 筆',
    '最後上傳成功', '接收器 7 的上傳方式', '由這支手機上傳']) expect(text(renderer)).toContain(words);
  await act(async () => pressable(renderer, accountPage(data).download.label).props.onPress());
  expect(retryDownload).toHaveBeenCalledTimes(1);
  await act(async () => pressable(renderer, '登出').props.onPress());
  expect(text(renderer)).toContain('登出 Supabase 帳號？');
  expect(signOut).not.toHaveBeenCalled();
  const confirm = renderer.root.findByProps({ testID: 'sign-out-dialog' })
    .findAll(node => node.props.accessibilityLabel === '登出' && typeof node.props.onPress === 'function')[0];
  await act(async () => confirm.props.onPress());
  expect(signOut).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('a switch that cannot send first keeps the dialog open with the reason; 取消 changes nothing', async () => {
  const { data } = input('upload-switch-confirm');
  const page = accountPage(data);
  const onSwitch = jest.fn(async () => { throw new Error('要先上傳完 120 筆，請連上網路'); });
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={page} onSwitch={onSwitch} />); });
  await act(async () => pressable(renderer, page.routes[0].label).props.onPress());
  await act(async () => pressable(renderer, '切換').props.onPress());
  expect(onSwitch).toHaveBeenCalledWith(7, 'phone');
  expect(text(renderer)).toContain('要先上傳完 120 筆，請連上網路');
  // The reason disables the action until the dialog is opened again.
  expect(pressable(renderer, '切換').props.disabled).toBe(true);
  await act(async () => pressable(renderer, '取消').props.onPress());
  expect(text(renderer)).not.toContain('改由這支手機上傳？');
  await act(async () => renderer.unmount());
});

test('signed out (or expired) S3 is the sign-in form; 稍後再說 goes back', async () => {
  const later = jest.fn();
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={{ signedIn: false, expired: true }}
    onLater={later} />); });
  expect(text(renderer)).toContain('登入 Supabase 帳號・需要重新登入');
  await act(async () => renderer.root.findByProps({ testID: 'login' }).props.onPress());
  expect(later).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

// ---- 登入失效 detection -----------------------------------------------------------

test('a refused sign-in is told apart from no network', () => {
  expect(isAuthFailure(cloudError('x', { code: 'PGRST301', message: 'JWT expired' }, 401))).toBe(true);
  expect(isAuthFailure(cloudError('x', { message: 'JWT expired' }))).toBe(true);
  expect(isAuthFailure({ context: { status: 401 } })).toBe(true);
  expect(isAuthFailure(cloudError('x', { message: 'TypeError: Network request failed' }, 0))).toBe(false);
  expect(isNetworkFailure(cloudError('無法讀取 Master 清單，請確認連線及權限', { message: 'TypeError: Network request failed' }, 0))).toBe(true);
  expect(isNetworkFailure(new Error('無法讀取 Master 清單，請確認連線及權限'))).toBe(false);
  expect(isNetworkFailure({ name: 'AuthRetryableFetchError', message: 'fetch' })).toBe(true);
  expect(isNetworkFailure(cloudError('x', { message: 'JWT expired' }, 401))).toBe(false);
});

test('a download refused for the sign-in marks authFailed; 重試 runs a pass now', async () => {
  jest.useFakeTimers();
  const changes = [];
  const result = { data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 };
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
    abortSignal: async () => result };
  const client = { from: jest.fn(() => query) };
  const database = { initialize: async () => {} };
  const sync = createCloudSync({ client, database, onChange: value => changes.push(value) });
  try {
    sync.setSession({ user: { id: 'alice' } });
    sync.setForeground(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });
    expect(changes[changes.length - 1]).toMatchObject({ authFailed: true, offline: false });
    expect(changes[changes.length - 1].failingSince).not.toBeNull();
    result.error = { message: 'TypeError: Network request failed' }; result.status = 0;
    const calls = client.from.mock.calls.length;
    sync.retry();
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });
    expect(client.from.mock.calls.length).toBeGreaterThan(calls);
    expect(changes[changes.length - 1]).toMatchObject({ authFailed: false, offline: true });
  } finally {
    await sync.dispose();
    jest.useRealTimers();
  }
});

function authClient({ refresh }) {
  const listeners = new Set();
  const emit = (event, session) => listeners.forEach(listener => listener(event, session));
  const client = { auth: {
    onAuthStateChange: callback => { listeners.add(callback); return { data: { subscription: { unsubscribe: () => {} } } }; },
    getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }),
    refreshSession: jest.fn(refresh),
    signOut: jest.fn(async () => { emit('SIGNED_OUT', null); return { error: null }; }),
  } };
  return client;
}

test('reportAuthFailure: a new session or no network keeps the sign-in; a refused refresh is 登入失效', async () => {
  let auth, renderer;
  function Probe() { auth = useAuth(); return null; }
  const renewed = authClient({ refresh: async () => ({ data: { session: { user: { id: 'alice' } } }, error: null }) });
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={() => renewed}><Probe /></AuthProvider>); });
  await act(async () => expect(await auth.reportAuthFailure()).toBe(false));
  expect(renewed.auth.signOut).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());

  const offline = authClient({ refresh: async () => ({ data: { session: null },
    error: { name: 'AuthRetryableFetchError', message: 'Network request failed' } }) });
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={() => offline}><Probe /></AuthProvider>); });
  await act(async () => expect(await auth.reportAuthFailure()).toBe(false));
  expect(auth.expired).toBe(false);
  await act(async () => renderer.unmount());

  const refused = authClient({ refresh: async () => ({ data: { session: null },
    error: { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' } }) });
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={() => refused}><Probe /></AuthProvider>); });
  await act(async () => expect(await auth.reportAuthFailure()).toBe(true));
  expect(refused.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(auth.user).toBeNull();
  expect(auth.expired).toBe(true);
  await act(async () => renderer.unmount());
});
