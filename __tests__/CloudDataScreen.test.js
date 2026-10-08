import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AuthProvider } from '../src/auth/AuthProvider';
import CloudDataScreen from '../src/cloud/CloudDataScreen';

let renderer;
// Signing in happens on S3; this page follows the shared client's session.
const withAuth = element => Renderer.create(<AuthProvider clientFactory={element.props.clientFactory}>
  {element}
</AuthProvider>);
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

let lastClient;
function fixtures() {
  // One client shared by AuthProvider and the page, as in the app.
  const listeners = new Set();
  const listener = (event, session) => listeners.forEach(callback => callback(event, session));
  const user = { id: 'account-a', email: 'user@example.test' };
  const client = lastClient = { auth: {
    onAuthStateChange: jest.fn(callback => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    }),
    getSession: jest.fn(async () => ({ data: { session: null } })),
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
    signInWithPassword: jest.fn(async () => { listener('SIGNED_IN', { user }); return { data: { session: { user } } }; }),
    signOut: jest.fn(async () => { listener('SIGNED_OUT', null); return {}; }),
  } };
  const database = {
    initialize: jest.fn(async () => {}), count: jest.fn(async () => 1),
    usage: jest.fn(async () => ({ rows: 1, bytes: 560, budget: 500 * 1024 * 1024, from: 1 })),
    listHistory: jest.fn(async () => [{ id: 1, master_id: 7, slave_id: 4,
      received_at: 1000, sequence: 'ACCOUNT_A_ONLY' }]),
    savePage: jest.fn(async () => {}),
  };
  return { client, database, emit: next => listener('SIGNED_IN', next) };
}
const text = () => JSON.stringify(renderer.toJSON());
async function press(label) {
  const button = renderer.root.findAll(node => node.props.accessibilityRole === 'button' &&
    node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  expect(button).toBeDefined();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => { await button.props.onPress(); });
}
async function login() {
  await act(async () => { await lastClient.auth.signInWithPassword(); });
}

test('signing in (on S3) loads only that account cache and signing out hides it', async () => {
  const { client, database } = fixtures();
  await act(async () => { renderer = withAuth(<CloudDataScreen database={database} clientFactory={() => client} />); });
  await login();
  expect(database.listHistory).toHaveBeenCalledWith('account-a', 0);
  expect(text()).toContain('ACCOUNT_A_ONLY');
  // No sign-in form or 登出 here: those are on S3.
  expect(text()).not.toContain('登入 Supabase 帳號');
  expect(text()).not.toContain('"登出"');
  await act(async () => { await client.auth.signOut(); });
  expect(text()).not.toContain('ACCOUNT_A_ONLY');
  expect(text()).toContain('登入 Supabase 帳號後');
});

test('late cache reads cannot display the previous account after an auth change', async () => {
  const { client, database, emit } = fixtures();
  let finishOldRead;
  database.listHistory.mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }));
  await act(async () => { renderer = withAuth(<CloudDataScreen database={database} clientFactory={() => client} />); });
  await login();
  database.listHistory.mockResolvedValue([]);
  await act(async () => { emit({ user: { id: 'account-b', email: 'b@example.test' } }); });
  await act(async () => { finishOldRead([{ id: 1, sequence: 'PRIVATE_OLD_ACCOUNT' }]); });
  expect(text()).not.toContain('PRIVATE_OLD_ACCOUNT');
  expect(text()).toContain('b@example.test');
});

test('automatic sync refreshes the local table without a manual download option', async () => {
  const { client, database } = fixtures();
  const clientFactory = () => client;
  await act(async () => { renderer = withAuth(<CloudDataScreen database={database}
    sync={{ revision: 0, mode: 'auto' }} clientFactory={clientFactory} />); });
  await login();
  expect(text()).toContain('自動同步中');
  expect(text()).not.toContain('下載到手機');
  expect(text()).not.toContain('開始日期');
  expect(text()).not.toContain('結束日期');
  expect(text()).toContain('ACCOUNT_A_ONLY');
  database.listHistory.mockResolvedValue([{ id: 2, sequence: 'AUTO_SYNC_NEW_ROW' }]);
  await act(async () => renderer.update(<AuthProvider clientFactory={clientFactory}><CloudDataScreen database={database}
    sync={{ revision: 1, lastSuccess: 1000 }} clientFactory={clientFactory} /></AuthProvider>));
  expect(text()).toContain('AUTO_SYNC_NEW_ROW');
  expect(text()).toContain('上次同步');
  await press('重新讀取本機資料');
  expect(database.savePage).not.toHaveBeenCalled();
});
