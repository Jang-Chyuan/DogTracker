import { t as i18nT } from '../src/i18n';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { applyScreenFixture, buildFixture, FIXTURE_NOW, FIXTURE_PAGES } from '../src/dev/ScreenFixtures';
import { receiverPage, settingsHome, settingsInput } from '../src/settings/SettingsModel';
import BangGlyph from '../src/components/BangGlyph';
import ReceiverSettings from '../src/settings/ReceiverSettings';
import { accountPage, signOutDialog, switchDialog } from '../src/settings/AccountModel';
import { receiverUploadSuccess } from '../src/cloudUpload/UploadSuccess';
import AccountSettings from '../src/settings/AccountSettings';
import { cloudError, isAuthFailure, isNetworkFailure } from '../src/cloud/CloudErrors';
import { createCloudSync } from '../src/cloud/CloudSync';
import { AuthProvider, refreshRefused, useAuth } from '../src/auth/AuthProvider';
import { formatClock } from '../src/map/MapFormat';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';

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
  for (const name of ['cloud-signed-out', 'cloud-ok', 'cloud-wifi-only', 'cloud-upload-pending', 'cloud-unreachable-retrying',
    'cloud-expired', 'upload-switch-confirm', 'upload-switch-offline']) {
    expect(buildFixture(name).openRoute).toBe('cloud');
  }
  expect(buildFixture('cloud-failing').openRoute).toBeNull();
  expect(buildFixture('cloud-failing', FIXTURE_NOW, 'cloud').openRoute).toBe('cloud');
});

test('cloud-signed-out: 未登入 with 登入, no 「!」 (not signed in is a choice)', () => {
  const { data } = input('cloud-signed-out');
  expect(accountPage(data)).toEqual({ signedIn: false, expired: false, restoring: false });
  expect(accountRow(data)).toMatchObject({ subtitle: i18nT('c302'), problem: false });
});

test('cloud-ok: signed in, last download, nothing waiting, receiver 7 uploads through this phone', () => {
  const { data } = input('cloud-ok');
  const page = accountPage(data);
  expect(page).toMatchObject({ signedIn: true, email: 'tim@example.com', offline: false, routesLoading: false });
  expect(page.download).toMatchObject({ title: i18nT('c217'), right: formatClock(FIXTURE_NOW - 5000), problem: false });
  expect(page.upload).toMatchObject({ problem: null, pendingText: '0 筆' });
  // 都已上傳 with the green tick, and 最後上傳成功 on receiver 7's own row.
  expect(page.upload.summary).toMatchObject({ title: i18nT('c417'), success: true, right: null });
  expect(page.routes[0].last).toMatchObject({ success: true, via: 'phone',
    text: `最後上傳成功 ${formatClock(FIXTURE_NOW - 8000)}（經手機）` });
  expect(page.routes).toEqual([expect.objectContaining({ master: 7, title: '接收器 7 的上傳方式',
    detail: i18nT('c219'), mode: 'phone', to: 'wifi', canSwitch: true })]);
  expect(accountRow(data)).toMatchObject({ problem: false, status: [i18nT('c208')] });
});

test('cloud-failing on S3 (as the mockup): 下載失敗 since when + 重試, 12 waiting, last upload', () => {
  const { data } = input('cloud-failing', 'cloud');
  const page = accountPage(data);
  expect(page.download).toEqual({ title: i18nT('c211'), detail: `連不上 Supabase・${formatClock(FIXTURE_NOW - 6 * MINUTE)} 起`,
    right: null, problem: true, success: false, retry: true, label: expect.stringContaining(i18nT('c211')) });
  expect(page.upload).toMatchObject({ problem: null, pendingText: '12 筆' });
  expect(page.upload.summary).toMatchObject({ title: i18nT('c215'), right: '12 筆', success: false });
  expect(page.routes[0].last.text).toBe(`最後上傳成功 ${formatClock(FIXTURE_NOW - 16 * MINUTE)}（經手機）`);
  expect(page.offline).toBe(true);
  expect(accountRow(data)).toMatchObject({ problem: true, label: 'Supabase 帳號，有問題：連不上' });
});

test('cloud-upload-pending: 需處理 with 「!」 + 重試, 手機還沒上傳 12 筆; the gear and S1 count it', () => {
  const { data, inputs } = input('cloud-upload-pending');
  const page = accountPage(data);
  expect(page.download.problem).toBe(false);
  expect(page.upload.problem).toMatchObject({ title: i18nT("c919"), right: '3 筆', problem: true, retry: true });
  expect(page.upload.pendingText).toBe('12 筆');
  expect(inputs.cloudProblem).toBe(true);
  expect(accountRow(data).problem).toBe(true);
});

test('cloud-unreachable-retrying: never reached Supabase since start → 「暫時連不上，會自動重試」', () => {
  const { data } = input('cloud-unreachable-retrying');
  const page = accountPage(data);
  expect(page.download).toMatchObject({ title: i18nT('c257'), problem: true, retry: true,
    detail: `連不上 Supabase・${formatClock(FIXTURE_NOW - 3 * MINUTE)} 起` });
  expect(page.upload.pendingText).toBe('4 筆');
});

test('cloud-expired: signed out with 需要重新登入; S1 and the gear say so', () => {
  const { data, inputs } = input('cloud-expired');
  expect(accountPage(data)).toEqual({ signedIn: false, expired: true, restoring: false });
  expect(inputs.signInExpired).toBe(true);
  expect(accountRow(data)).toMatchObject({ problem: true, label: 'Supabase 帳號，有問題：需要重新登入' });
});

test('upload-switch-confirm: receiver 7 by Wi-Fi with 120 waiting, the confirmation open (c255)', async () => {
  const { fixture, data } = input('upload-switch-confirm');
  const page = accountPage(data);
  const route = page.routes[0];
  expect(route).toMatchObject({ master: 7, detail: i18nT('c416'), to: 'phone', pending: 120 });
  expect(fixture.dialog).toEqual({ kind: 'switch', master: 7 });
  expect(switchDialog(route, { offline: page.offline })).toEqual({ title: i18nT("c930"),
    body: '這台接收器改由這支手機上傳。手機裡還有 120 筆沒上傳，會先上傳。', blockedBy: null, confirm: i18nT("c928") });
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

test('an active initial retry says downloading instead of a stale failure; later polling keeps the last success', () => {
  const data = { account: { signedIn: true }, sync: { busy: true, mode: 'auto', lastSuccess: null,
    failingSince: FIXTURE_NOW - MINUTE, offline: true } };
  expect(accountPage(data).download).toMatchObject({ right: i18nT('c319'), problem: false, success: false, retry: false });
  expect(accountPage({ ...data, sync: { ...data.sync, busy: false } }).download)
    .toMatchObject({ problem: true, retry: true });
  expect(accountPage({ ...data, sync: { ...data.sync, failingSince: null, lastSuccess: FIXTURE_NOW - MINUTE } }).download)
    .toMatchObject({ right: formatClock(FIXTURE_NOW - MINUTE), problem: false, success: true, retry: false });
});

test('download before the first pass says 下載中…; switching back to Wi-Fi needs no network when nothing waits', () => {
  const page = accountPage({ account: { signedIn: true, email: 'a@b' }, sync: { ownerId: 'a' },
    upload: { supported: true, settingsReady: true, masters: [], settings: [{ master_id: 5, mode: 'phone' }],
      counts: [], error: '' } });
  expect(page.download).toMatchObject({ right: i18nT('c319'), problem: false });
  // Nothing has ever needed uploading: that is said once, never as 都已上傳
  // over 「最後成功 還沒有」 (070).
  expect(page.upload.summary).toMatchObject({ title: i18nT("c1233"), right: null, success: false });
  expect(page.routes[0].last).toBeNull();
  // Not authorized for 5 any more: going back to Wi-Fi is still allowed.
  expect(page.routes[0]).toMatchObject({ master: 5, canSwitch: true, to: 'wifi', pending: 0 });
  expect(switchDialog(page.routes[0], { offline: true })).toEqual({ title: i18nT("c931"),
    body: i18nT("c927"), blockedBy: null, confirm: i18nT("c928") });
});

test('an unauthorized receiver cannot be switched to this phone; an upload error reads in field words', () => {
  const page = accountPage({ account: { signedIn: true }, sync: {},
    upload: { supported: true, settingsReady: true, masters: [], settings: [{ master_id: 9, mode: 'wifi' }],
      counts: [{ status: 'pending', count: 2 }], error: 'Network request failed' } });
  expect(page.routes[0]).toMatchObject({ canSwitch: false });
  expect(page.upload.problem).toMatchObject({ title: i18nT("c920"), detail: i18nT("c932"), problem: true });
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
    'account-route-7', 'account-route-7-last']);
  for (const words of ['tim@example.com', '已登入', '下載', '下載失敗', '重試 ›', '上傳', '手機還沒上傳', '12 筆',
    '接收器 7 的上傳方式', '由這支手機上傳', '（經手機）']) expect(text(renderer)).toContain(words);
  // 最後成功 is the download's word; the upload says 最後上傳成功 per receiver.
  expect(text(renderer)).not.toContain('還沒有');
  await act(async () => pressable(renderer, accountPage(data).download.label).props.onPress());
  expect(retryDownload).toHaveBeenCalledTimes(1);
  await act(async () => pressable(renderer, '登出').props.onPress());
  expect(text(renderer)).toContain(i18nT("c924"));
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
  expect(onSwitch).toHaveBeenCalledWith(7, 'phone', expect.objectContaining({ aborted: false }));
  expect(text(renderer)).toContain('要先上傳完 120 筆，請連上網路');
  // The reason disables the action until the dialog is opened again.
  expect(pressable(renderer, i18nT("c928")).props.disabled).toBe(true);
  await act(async () => pressable(renderer, '取消').props.onPress());
  expect(text(renderer)).not.toContain(i18nT("c930"));
  await act(async () => renderer.unmount());
});

test('signed out S3: 未登入 or 需要重新登入 with 登入 (→ D1); restoring says it retries by itself', async () => {
  const signIn = jest.fn();
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={{ signedIn: false, expired: true }}
    onSignIn={signIn} />); });
  expect(text(renderer)).toContain(i18nT('c276'));
  expect(text(renderer)).not.toContain(i18nT('c001'));
  await act(async () => pressable(renderer, '需要重新登入，登入').props.onPress());
  expect(signIn).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<AccountSettings page={{ signedIn: false, expired: false }} onSignIn={signIn} />));
  await act(async () => pressable(renderer, '未登入，登入').props.onPress());
  expect(signIn).toHaveBeenCalledTimes(2);
  await act(async () => renderer.update(<AccountSettings page={{ signedIn: false, expired: false, restoring: true }}
    onSignIn={signIn} />));
  expect(text(renderer)).toContain(i18nT('c257'));
  expect(pressable(renderer, '未登入，登入')).toBeUndefined();
  await act(async () => renderer.unmount());
});

test('auth-restore-slow: S3 says 暫時連不上，會自動重試 while the saved sign-in waits', () => {
  const { data } = input('auth-restore-slow', 'cloud');
  expect(accountPage(data)).toEqual({ signedIn: false, expired: false, restoring: true });
});

// ---- 登入失效 detection -----------------------------------------------------------

test('a refused sign-in is told apart from no network', () => {
  expect(isAuthFailure(cloudError('x', { code: 'PGRST301', message: 'JWT expired' }, 401))).toBe(true);
  expect(isAuthFailure(cloudError('x', { message: 'JWT expired' }))).toBe(true);
  expect(isAuthFailure({ context: { status: 401 } })).toBe(true);
  expect(isAuthFailure(cloudError('x', { message: 'TypeError: Network request failed' }, 0))).toBe(false);
  expect(isNetworkFailure(cloudError(i18nT("c581"), { message: 'TypeError: Network request failed' }, 0))).toBe(true);
  expect(isNetworkFailure(new Error(i18nT("c581")))).toBe(false);
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

test('only an explicit refusal of the refresh token ends the sign-in', () => {
  expect(refreshRefused({ status: 400, message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe(true);
  expect(refreshRefused({ code: 'refresh_token_not_found' })).toBe(true);
  expect(refreshRefused({ status: 429, message: 'Too many requests' })).toBe(false);
  expect(refreshRefused({ status: 503, message: 'Service unavailable' })).toBe(false);
  expect(refreshRefused({ message: 'something odd' })).toBe(false);
});

test('a dialog opened for one account closes when the account changes', async () => {
  const { data } = input('upload-switch-confirm');
  const page = accountPage(data);
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={page} onSwitch={jest.fn()} />); });
  await act(async () => pressable(renderer, page.routes[0].label).props.onPress());
  expect(text(renderer)).toContain(i18nT("c930"));
  await act(async () => renderer.update(<AccountSettings page={{ ...page, email: 'other@example.com' }}
    onSwitch={jest.fn()} />));
  expect(text(renderer)).not.toContain(i18nT("c930"));
  await act(async () => renderer.unmount());
});

test.each([
  ['cloud-ok', true], ['cloud-upload-pending', true], ['cloud-wifi-only', false],
 ])('S3 %s shows phone upload rows only for a phone route', async (name, visible) => {
  const { data } = input(name);
  const page = accountPage(data);
  expect(page.upload.visible).toBe(visible);
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={page} />); });
  expect(renderer.root.findAllByProps({ testID: 'account-upload-pending' }).length > 0).toBe(visible);
  if (visible) {
    expect(text(renderer)).toContain(page.upload.pending > 0 ? `手機還沒上傳 ${page.upload.pendingText}` : i18nT('c417'));
    if (!page.upload.pending) expect(text(renderer)).not.toContain('0 筆');
  }
  else {
    expect(text(renderer)).not.toContain(i18nT('c215'));
    for (const route of page.routes) expect(text(renderer)).toContain(route.label);
  }
  // 最後上傳成功 belongs to the receiver, so it is drawn whether or not the
  // phone's own upload rows are (070: switching to Wi-Fi must not hide it).
  for (const route of page.routes) {
    expect(renderer.root.findAllByProps({ testID: `account-route-${route.master}-last` }).length > 0)
      .toBe(!!route.last);
    if (route.last) expect(text(renderer)).toContain(route.last.text);
  }
  await act(async () => renderer.unmount());
});

test.each([0, 3])('Wi-Fi-only exposes upload failures and blocked rows (%s blocked)', async blocked => {
  const { data } = input('cloud-wifi-only');
  data.upload = { ...data.upload, error: 'Network request failed', counts: [{ status: 'blocked', count: blocked }] };
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={accountPage(data)} />); });
  expect(renderer.root.findAllByProps({ testID: 'account-upload-problem' }).length).toBeGreaterThan(0);
  await act(async () => renderer.unmount());
});

test('mixed phone and Wi-Fi routes still show phone upload status', () => {
  const { data } = input('cloud-wifi-only');
  data.upload.settings[1].mode = 'phone';
  expect(accountPage(data).upload.visible).toBe(true);
  data.upload.settingsReady = false;
  expect(accountPage(data).upload.visible).toBe(false);
  data.upload.supported = false;
  expect(accountPage(data).upload.visible).toBe(false);
});

test('K13: Wi-Fi routes still expose queued and refused uploads', () => {
  const { data } = input('upload-switch-confirm');
  expect(accountPage(data).upload).toMatchObject({ visible: true, pendingText: '120 筆' });
  const refused = input('cloud-upload-pending').data;
  refused.upload.settings = refused.upload.settings.map(row => ({ ...row, mode: 'wifi' }));
  expect(accountPage(refused).upload).toMatchObject({ visible: true, problem: expect.objectContaining({ retry: true }) });
});

test('K14: cancel during a slow switch aborts work and late failures do not reopen the dialog', async () => {
  const { data } = input('upload-switch-confirm');
  let reject, signal;
  const onSwitch = jest.fn((master, mode, token) => { signal = token; return new Promise((resolve, fail) => { reject = fail; }); });
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={accountPage(data)} onSwitch={onSwitch} dialog={{ kind: 'switch', master: 7 }} />); });
  await act(async () => { pressable(renderer, '切換').props.onPress(); });
  await act(async () => pressable(renderer, '取消').props.onPress());
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error('late failure')));
  expect(text(renderer)).not.toContain('late failure');
  expect(pressable(renderer, i18nT('c046'))).toBeUndefined();
  await act(async () => renderer.unmount());
});

// ---- 最後上傳成功, the one line S3 and S2 share (070) --------------------------

// One receiver's saved upload route, as useCloudUpload reports it.
const routed = (mode, master = 5) => ({ supported: true, settingsReady: true,
  masters: [master], settings: [{ master_id: master, mode }] });

test('最後上傳成功 uses the selected route and keeps the other route history through switches', () => {
  const byPhone = FIXTURE_NOW - 10 * MINUTE;
  const byWifi = FIXTURE_NOW - 30 * MINUTE;
  // Uploading through this phone, nothing downloaded from the receiver's Wi-Fi.
  expect(receiverUploadSuccess({ ...routed('phone'), lastByMaster: { 5: byPhone } }, 5)).toEqual({
    text: `最後上傳成功 ${formatClock(byPhone)}（經手機）`,
    label: `最後上傳成功 ${formatClock(byPhone)}（經手機）`, success: true, at: byPhone, via: 'phone' });
  // Switched back to its own Wi-Fi with no Wi-Fi row downloaded yet: the
  // success this phone had stays on the page (the reported bug: it vanished).
  expect(receiverUploadSuccess({ ...routed('wifi'), lastByMaster: { 5: byPhone } }, 5))
    .toMatchObject({ text: i18nT('c1232'), success: false, previous: { via: 'phone', at: byPhone } });
  // Its Wi-Fi has uploaded since: the line follows the newer evidence.
  expect(receiverUploadSuccess({ ...routed('wifi'), lastByMaster: { 5: byWifi - MINUTE },
    wifiByMaster: { 5: byWifi } }, 5)).toMatchObject({ success: true, via: 'wifi', at: byWifi,
    text: `最後上傳成功 ${formatClock(byWifi)}（經 Wi-Fi）` });
  // Newly switched to this phone, before the first row goes up from here: what
  // its Wi-Fi uploaded is still the last success.
  expect(receiverUploadSuccess({ ...routed('phone'), wifiByMaster: { 5: byWifi } }, 5))
    .toMatchObject({ success: true, via: 'wifi', at: byWifi });
  // Each receiver answers for itself.
  const two = { supported: true, settingsReady: true, masters: [5, 7],
    settings: [{ master_id: 5, mode: 'phone' }, { master_id: 7, mode: 'wifi' }],
    lastByMaster: { 5: byPhone }, wifiByMaster: { 7: byWifi } };
  expect(receiverUploadSuccess(two, 5)).toMatchObject({ via: 'phone' });
  expect(receiverUploadSuccess(two, 7)).toMatchObject({ via: 'wifi' });
});

test('最後上傳成功 with nothing to show: its own Wi-Fi says so, through this phone it says nothing', () => {
  expect(receiverUploadSuccess(routed('wifi'), 5)).toEqual({ text: i18nT("c1232"),
    label: i18nT("c1232"), success: false, at: null, via: null });
  // The 上傳 group above already says what waits in this phone.
  expect(receiverUploadSuccess(routed('phone'), 5)).toBeNull();
  // No guess at a route before the saved ones are read, or where this phone
  // cannot upload at all.
  expect(receiverUploadSuccess({ supported: true, settingsReady: false, masters: [5] }, 5)).toBeNull();
  expect(receiverUploadSuccess({ ...routed('wifi'), supported: false }, 5)).toBeNull();
  // Times that are not times, and a receiver without a number.
  expect(receiverUploadSuccess({ ...routed('phone'), lastByMaster: { 5: 0 },
    wifiByMaster: { 5: null } }, 5)).toBeNull();
  expect(receiverUploadSuccess({ ...routed('wifi'), wifiByMaster: { 5: 1000 } }, null)).toBeNull();
});

test('S3 and S2 draw the same 最後上傳成功 line for the same receiver', async () => {
  const { data } = input('cloud-wifi-only');
  // Receiver 7 is on its own Wi-Fi again, but this phone uploaded for it more
  // recently; receiver 8 has never uploaded anything this phone knows about.
  const upload = { ...data.upload, lastByMaster: { 7: FIXTURE_NOW - MINUTE } };
  const expected = receiverUploadSuccess(upload, 7);
  expect(expected.via).toBe('wifi');
  expect(expected.previous.text).toBe(`最後上傳成功 ${formatClock(FIXTURE_NOW - MINUTE)}（經手機）`);
  const page = accountPage({ ...data, upload });
  // S3: nothing waits in this phone, so the 上傳 rows are hidden — the
  // receiver's own line is still there (070).
  expect(page.upload.visible).toBe(false);
  let renderer;
  await act(async () => { renderer = Renderer.create(<AccountSettings page={page} />); });
  const title = id => renderer.root.findByProps({ testID: id }).props.title;
  expect(title('account-route-7-last')).toBe(expected.text);
  expect(title('account-route-7-previous')).toBe(expected.previous.text);
  expect(title('account-route-8-last')).toBe(i18nT("c1232"));
  await act(async () => renderer.unmount());
  // S2, the receiver in front: the same line, from the same function.
  const receiver = receiverPage({ ...data, upload });
  expect(receiver.uploadLast).toEqual(expected);
  await act(async () => { renderer = Renderer.create(<ReceiverSettings page={receiver} />); });
  expect(renderer.root.findByProps({ testID: 'receiver-upload-last' }).props.title).toBe(expected.text);
  expect(renderer.root.findByProps({ testID: 'receiver-upload-previous' }).props.title).toBe(expected.previous.text);
  await act(async () => renderer.unmount());
  // Nothing to say for the receiver in front: no empty row on S2.
  const quiet = receiverPage({ ...data, upload: { ...upload, lastByMaster: {}, wifiByMaster: {},
    settings: [{ master_id: 7, mode: 'phone' }] } });
  expect(quiet.uploadLast).toBeNull();
  await act(async () => { renderer = Renderer.create(<ReceiverSettings page={quiet} />); });
  expect(renderer.root.findAllByProps({ testID: 'receiver-upload-last' })).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('a cloud success carries the green tick where a failure carries the red 「!」', async () => {
  const ticks = renderer => renderer.root.findAll(node => node.props.name === 'check-circle').length;
  const bangs = renderer => renderer.root.findAllByType(BangGlyph).length;
  let renderer;
  // All well: 下載 最後成功, 都已上傳 and 最後上傳成功 each carry the tick.
  const ok = accountPage(input('cloud-ok').data);
  expect([ok.download.success, ok.upload.summary.success, ok.routes[0].last.success])
    .toEqual([true, true, true]);
  await act(async () => { renderer = Renderer.create(<AccountSettings page={ok} />); });
  expect(ticks(renderer)).toBe(3);
  expect(bangs(renderer)).toBe(0);
  await act(async () => renderer.unmount());
  // Downloads failing: the red 「!」 in that same place, and no tick on it.
  const failing = accountPage(input('cloud-failing', 'cloud').data);
  expect(failing.download).toMatchObject({ problem: true, success: false });
  await act(async () => { renderer = Renderer.create(<AccountSettings page={failing} />); });
  expect(bangs(renderer)).toBe(1);
  expect(ticks(renderer)).toBe(1);
  await act(async () => renderer.unmount());
  // Rows the cloud refused: 需處理 carries it too (and 手機還沒上傳 no tick).
  const refused = accountPage(input('cloud-upload-pending').data);
  expect(refused.upload.problem).toMatchObject({ problem: true, success: false });
  expect(refused.upload.summary.success).toBe(false);
  await act(async () => { renderer = Renderer.create(<AccountSettings page={refused} />); });
  expect(bangs(renderer)).toBe(1);
  await act(async () => renderer.unmount());
});

const statusCases = ['success', 'failure', 'nothing'].flatMap(state =>
  ['phone', 'wifi'].flatMap(mode => [false, true].map(switched => [state, mode, switched])));

test.each(statusCases)('S3/S2 status matrix: %s, %s, switched=%s', async (state, mode, switched) => {
  const { data } = input('cloud-ok');
  const master = receiverPage(data).number;
  const history = state === 'nothing' ? {} : { [master]: FIXTURE_NOW - MINUTE };
  const wifi = state === 'success' ? { [master]: FIXTURE_NOW - 2 * MINUTE } : {};
  const upload = { ...routed(mode, master), last: state === 'nothing' ? null : history[master],
    lastByMaster: history, wifiByMaster: wifi,
    counts: state === 'failure' ? [{ status: 'pending', count: 1 }] : [],
    pendingByMaster: state === 'failure' ? { [master]: 1 } : {},
    error: state === 'failure' ? 'Network request failed' : '' };
  if (switched) {
    const before = { ...upload, settings: [{ master_id: master, mode: mode === 'phone' ? 'wifi' : 'phone' }] };
    const beforeResult = receiverUploadSuccess(before, master);
    if (history[master]) expect(JSON.stringify(beforeResult)).toContain('經手機');
  }
  const account = accountPage({ ...data, upload });
  const receiver = receiverPage({ ...data, upload });
  expect(receiver.uploadLast).toEqual(account.routes[0].last);
  if (mode === 'wifi') {
    expect(receiver.uploadLast.text).toBe(wifi[master]
      ? `最後上傳成功 ${formatClock(wifi[master])}（經 Wi-Fi）` : i18nT('c1232'));
    if (history[master]) expect(receiver.uploadLast.previous.via).toBe('phone');
  }
  let accountTree, receiverTree;
  try {
    await act(async () => {
      accountTree = Renderer.create(<AccountSettings page={account} />);
      receiverTree = Renderer.create(<ReceiverSettings page={receiver} />);
    });
    for (const tree of [accountTree, receiverTree]) {
      if (history[master]) expect(text(tree)).toContain(`最後上傳成功 ${formatClock(history[master])}（經手機）`);
    }
    expect(accountTree.root.findAllByType(BangGlyph)).toHaveLength(state === 'failure' ? 1 : 0);
    expect(receiverTree.root.findAllByType(BangGlyph)).toHaveLength(state === 'failure' ? 1 : 0);
    if (state === 'nothing') {
      expect(text(accountTree)).not.toContain(i18nT('c417'));
      expect(accountTree.root.findAllByType(BangGlyph)).toHaveLength(0);
      if (mode === 'phone') expect(text(accountTree)).toContain(i18nT('c1233'));
    }
    if (state === 'failure') expect(text(accountTree)).not.toContain(i18nT('c417'));
  } finally {
    await act(async () => { accountTree?.unmount(); receiverTree?.unmount(); });
  }
});


test('receiver Wi-Fi route shows its own blocked phone rows, without borrowing another receiver failure', () => {
  const { data } = input('cloud-ok');
  const master = receiverPage(data).number;
  const upload = { ...routed('wifi', master), counts: [{ status: 'blocked', count: 3 }],
    blockedByMaster: { [master]: 3 }, pendingByMaster: {} };
  expect(receiverPage({ ...data, upload }).uploadProblem).toMatchObject({ problem: true, right: '3 筆' });
  expect(receiverPage({ ...data, upload: { ...upload, blockedByMaster: { 99: 3 } } }).uploadProblem).toBeNull();
});
