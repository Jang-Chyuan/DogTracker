import React, { useEffect, useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, NativeModules, Text, TextInput } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AuthGate } from '../App';
import AccountSettings from '../src/settings/AccountSettings';
import { accountPage } from '../src/settings/AccountModel';
import { useCloudSync } from '../src/cloud/useCloudSync';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { useHistoryCloudSource } from '../src/mapHistory/HistoryCloud';
import SettingsHome from '../src/settings/SettingsHome';
import { settingsHome } from '../src/settings/SettingsModel';
import LoginScreen, { signInErrorText } from '../src/screens/LoginScreen';

// One Supabase client shared by every subscriber (AuthProvider, useCloudSync,
// S3), as getCloudClient returns in the app.
function supabase({ restored = null } = {}) {
  const listeners = new Set();
  let restore;
  const emit = (event, session) => listeners.forEach(listener => listener(event, session));
  const user = { id: 'account-a', email: 'user@example.test' };
  const auth = {
    onAuthStateChange: jest.fn(callback => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    }),
    getSession: jest.fn(() => (restored === 'manual'
      ? new Promise(resolve => { restore = session => resolve({ data: { session } }); })
      : Promise.resolve({ data: { session: restored } }))),
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
    signInWithPassword: jest.fn(async () => {
      emit('SIGNED_IN', { user });
      return { data: { session: { user } }, error: null };
    }),
    signOut: jest.fn(async () => { emit('SIGNED_OUT', null); return { error: null }; }),
  };
  // Any table read fails loudly: signed out, nothing may reach the network.
  const from = jest.fn(() => { throw new Error('network used'); });
  const client = { auth, from };
  return { client, factory: () => client, user, emit, restore: session => restore(session) };
}

// A cloud database that records every call.
function spyDatabase() {
  const calls = [];
  const record = name => jest.fn(async (...args) => { calls.push([name, ...args]); return name === 'count' ? 0 : []; });
  return {
    calls,
    initialize: record('initialize'), listHistory: record('listHistory'), count: record('count'),
    usage: jest.fn(async () => ({ rows: 0, bytes: 0 })), savePage: record('savePage'),
    latestBySlave: record('latestBySlave'), latestStatusRows: record('latestStatusRows'),
    trackBySlave: record('trackBySlave'), holdRows: record('holdRows'),
  };
}

// S3 as App draws it: the account page from AuthProvider and the sync; its
// 「登入」 opens D1 over it, and D1's ways out come back to it.
function AccountPage({ sync = {}, onLater }) {
  const auth = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  if (signingIn) {
    return <LoginScreen expired={auth.expired} onDone={() => setSigningIn(false)}
      onLater={() => { setSigningIn(false); onLater?.(); }} />;
  }
  return <AccountSettings onSignIn={() => setSigningIn(true)} onSignOut={auth.signOut}
    page={accountPage({ account: { signedIn: !!auth.user, email: auth.user?.email || '' },
      signInExpired: auth.expired, restoring: auth.restoring, sync, upload: { settingsReady: true } })} />;
}

let renderer, previousCloud, previousBle;
beforeEach(() => {
  previousCloud = NativeModules.CloudBackgroundSync; previousBle = NativeModules.BleBackground;
  NativeModules.CloudBackgroundSync = { setOwner: jest.fn(async () => {}) };
  NativeModules.BleBackground = { executeDatabase: jest.fn(async () => '{}') };
  AppState.currentState = 'active';
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  NativeModules.CloudBackgroundSync = previousCloud; NativeModules.BleBackground = previousBle;
  jest.useRealTimers();
});
const text = () => JSON.stringify(renderer.toJSON());

test('signed out, the gate opens the app (the map) instead of a login wall', async () => {
  const s = supabase({ restored: 'manual' }), mounted = jest.fn();
  function Main() { useEffect(() => { mounted(); }, []); return <Text>Live map</Text>; }
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={s.factory}>
    <AuthGate><Main /></AuthGate>
  </AuthProvider>); });
  // The app starts while the session is restored (under the launch screen).
  expect(mounted).toHaveBeenCalledTimes(1);
  await act(async () => s.restore(null));
  expect(text()).toContain('Live map');
  expect(text()).not.toContain('登入 Supabase 帳號');
  expect(mounted).toHaveBeenCalledTimes(1);
});

test('signing in or out keeps the app mounted; only a direct account switch starts it over', async () => {
  const s = supabase(), mounted = jest.fn(), unmounted = jest.fn();
  function Main() { useEffect(() => { mounted(); return unmounted; }, []); return <Text>Live map</Text>; }
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={s.factory}>
    <AuthGate><Main /></AuthGate>
  </AuthProvider>); });
  await act(async () => s.emit('SIGNED_IN', { user: s.user }));
  await act(async () => s.emit('SIGNED_OUT', null));
  // Logging out still stops background work at once.
  expect(NativeModules.CloudBackgroundSync.setOwner).toHaveBeenCalledWith(null);
  expect(NativeModules.BleBackground.executeDatabase).toHaveBeenCalledWith(expect.stringContaining("key='owner'"), '[]');
  await act(async () => s.emit('SIGNED_IN', { user: s.user }));
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  // Signed out of A, then B signs in on the 雲端資料 page: the page stays.
  await act(async () => s.emit('SIGNED_OUT', null));
  await act(async () => s.emit('SIGNED_IN', { user: { id: 'account-b' } }));
  expect(unmounted).not.toHaveBeenCalled();
  // Only a direct switch from one account to another starts over.
  await act(async () => s.emit('SIGNED_IN', { user: { id: 'account-c' } }));
  expect(unmounted).toHaveBeenCalledTimes(1);
  expect(mounted).toHaveBeenCalledTimes(2);
  expect(text()).toContain('Live map');
});

test('登入失效 while in use is told apart from signing out', async () => {
  const s = supabase({ restored: { user: { id: 'account-a' } } }); let auth;
  function Probe() { auth = useAuth(); return null; }
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={s.factory}><Probe /></AuthProvider>); });
  expect(auth.expired).toBe(false);
  // The refresh token was refused: Supabase signs the phone out by itself.
  await act(async () => s.emit('SIGNED_OUT', null));
  expect(auth.user).toBeNull();
  expect(auth.expired).toBe(true);
  await act(async () => s.emit('SIGNED_IN', { user: s.user }));
  expect(auth.expired).toBe(false);
  await act(async () => auth.signOut());
  expect(auth.user).toBeNull();
  expect(auth.expired).toBe(false);
});

test('without an account the cloud hooks stay idle: no sync, no reads of cloud rows, no errors', async () => {
  jest.useFakeTimers();
  const s = supabase(), database = spyDatabase();
  let sync, dogs, historyCloud;
  function Probe() {
    sync = useCloudSync(database, true, s.factory);
    dogs = useCloudDogs(database, sync.ownerId, true);
    historyCloud = useHistoryCloudSource({ database, sync, owner: sync.ownerId, clientFactory: s.factory });
    return null;
  }
  await act(async () => { renderer = Renderer.create(<Probe />); });
  await act(async () => { jest.advanceTimersByTime(65000); });
  expect(sync.ownerId).toBeNull();
  expect(sync.error).toBeFalsy();
  expect(dogs.error).toBeFalsy();
  expect(dogs.rows).toEqual([]);
  // The history's calendar has nothing to ask and nothing to download.
  expect(historyCloud.cloud).toBeNull();
  expect(s.client.from).not.toHaveBeenCalled();
  // No cloud sync pass and no read of any account's cloud rows.
  expect(database.calls.filter(([name]) => name === 'initialize' || name === 'savePage')).toEqual([]);
  expect(database.calls.filter(([, owner]) => typeof owner === 'string')).toEqual([]);
  expect(NativeModules.CloudBackgroundSync.setOwner).toHaveBeenLastCalledWith(null);
});

test('signing in from 設定 → Supabase 帳號 (S3) starts the sync and stays on that page', async () => {
  const s = supabase(), database = spyDatabase(), later = jest.fn();
  let sync;
  function Page() {
    sync = useCloudSync(database, true, s.factory);
    return <AccountPage sync={sync} onLater={later} />;
  }
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={s.factory}><Page /></AuthProvider>); });
  // S3 signed out: 「未登入」 and 「登入」 → D1, whose 「稍後再說」 comes back.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(text()).toContain('未登入');
  expect(text()).not.toContain('登入 Supabase 帳號');
  const button = label => renderer.root.findAll(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  await act(async () => button('未登入，登入').props.onPress());
  expect(text()).toContain('登入 Supabase 帳號');
  expect(text()).toContain('不登入也可以用，只顯示這支手機連到的接收器。');
  await act(async () => button('稍後再說').props.onPress());
  expect(later).toHaveBeenCalledTimes(1);
  expect(text()).toContain('未登入');
  await act(async () => button('未登入，登入').props.onPress());
  expect(database.calls.some(([name]) => name === 'initialize')).toBe(false);
  const input = label => renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label);
  await act(async () => {
    input('電子郵件').props.onChangeText('user@example.test');
    input('密碼').props.onChangeText('test-only-password');
  });
  await act(async () => button('登入').props.onPress());
  expect(s.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.test', password: 'test-only-password' });
  expect(sync.ownerId).toBe('account-a');
  expect(NativeModules.CloudBackgroundSync.setOwner).toHaveBeenLastCalledWith('account-a');
  // The scheduler's first pass runs right away (and reaches the database).
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(database.calls.some(([name]) => name === 'initialize')).toBe(true);
  expect(text()).toContain('user@example.test');
  expect(text()).toContain('登出');
});

test('登入失效 on S3 asks to sign in again there', async () => {
  const s = supabase({ restored: { user: { id: 'account-a', email: 'user@example.test' } } });
  const database = spyDatabase();
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={s.factory}>
    <AccountPage />
  </AuthProvider>); });
  expect(text()).toContain('user@example.test');
  expect(database.calls).toEqual([]);
  await act(async () => s.emit('SIGNED_OUT', null));
  expect(text()).toContain('需要重新登入');
  // 「登入」 opens D1, which says it too.
  const signIn = renderer.root.findAll(node => node.props.accessibilityLabel === '需要重新登入，登入'
    && typeof node.props.onPress === 'function')[0];
  await act(async () => signIn.props.onPress());
  expect(text()).toContain('登入 Supabase 帳號');
  expect(text()).toContain('需要重新登入');
});

test('settings says 未登入 as a plain state, and 需要重新登入 after 登入失效', async () => {
  const home = (account, signInExpired = false) => <SettingsHome onOpen={() => {}}
    home={settingsHome({ now: 0, receiverState: null, account, signInExpired })} />;
  await act(async () => { renderer = Renderer.create(home({ signedIn: false, email: '' })); });
  expect(text()).toContain('未登入');
  // Not signed in is a choice: no red 「!」 on the Supabase row.
  expect(text()).not.toContain('Supabase 帳號，有問題');
  await act(async () => renderer.update(home({ signedIn: false, email: '' }, true)));
  expect(text()).toContain('Supabase 帳號，有問題：需要重新登入');
  await act(async () => renderer.update(home({ signedIn: true, email: 'user@example.test' })));
  expect(text()).toContain('user@example.test');
});

test('sign-in failures read as the design says', () => {
  expect(signInErrorText({ status: 400, message: 'Invalid login credentials' })).toBe('電子郵件或密碼不對');
  expect(signInErrorText(new TypeError('Network request failed'))).toBe('連不上網路');
  expect(signInErrorText(new Error('請輸入電子郵件和密碼'))).toBe('請輸入電子郵件和密碼');
  expect(signInErrorText(null)).toBe('登入失敗，請稍後重試');
});

test('登入 is checked when pressed: empty fields say so and reach no server', async () => {
  const s = supabase();
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={s.factory}>
    <AccountPage />
  </AuthProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '未登入，登入'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  const login = renderer.root.findAll(node => node.props.accessibilityLabel === '登入'
    && typeof node.props.onPress === 'function')[0];
  expect(login.props.disabled).toBe(false);
  await act(async () => login.props.onPress());
  expect(text()).toContain('請輸入電子郵件和密碼');
  expect(s.client.auth.signInWithPassword).not.toHaveBeenCalled();
});

test('a download refused for the sign-in asks once whether the sign-in ended (登入失效)', async () => {
  const s = supabase({ restored: { user: { id: 'account-a' } } }), database = spyDatabase();
  const refused = { data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 };
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
    abortSignal: async () => refused };
  s.client.from = jest.fn(() => query);
  const failures = jest.fn();
  let sync;
  function Probe() { sync = useCloudSync(database, true, s.factory, failures); return null; }
  await act(async () => { renderer = Renderer.create(<Probe />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(sync.authFailed).toBe(true);
  expect(failures).toHaveBeenCalledTimes(1);
  // 重試 runs another pass; the same refusal is reported again (a new pass).
  await act(async () => { sync.retry(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(s.client.from.mock.calls.length).toBeGreaterThan(1);
});
