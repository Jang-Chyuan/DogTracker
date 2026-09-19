import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import CloudScreen from '../src/cloud/CloudScreen';

let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

function fixtures() {
  let listener;
  const user = { id: 'account-a', email: 'user@example.test' };
  const client = { auth: {
    onAuthStateChange: jest.fn(callback => {
      listener = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    getSession: jest.fn(async () => ({ data: { session: null } })),
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
    signInWithPassword: jest.fn(async () => { listener('SIGNED_IN', { user }); return {}; }),
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
  await act(async () => {
    renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Email')
      .props.onChangeText('user@example.test');
    renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '密碼')
      .props.onChangeText('test-only-password');
  });
  await press('登入');
}

test('login loads only that account cache and logout hides it and clears password', async () => {
  const { client, database } = fixtures();
  await act(async () => { renderer = Renderer.create(<CloudScreen database={database} clientFactory={() => client} />); });
  await login();
  expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.test', password: 'test-only-password' });
  expect(database.listHistory).toHaveBeenCalledWith('account-a', 0);
  expect(text()).toContain('ACCOUNT_A_ONLY');
  await press('登出');
  expect(text()).not.toContain('ACCOUNT_A_ONLY');
  expect(renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '密碼').props.value).toBe('');
});

test('late cache reads cannot display the previous account after an auth change', async () => {
  const { client, database, emit } = fixtures();
  let finishOldRead;
  database.listHistory.mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }));
  await act(async () => { renderer = Renderer.create(<CloudScreen database={database} clientFactory={() => client} />); });
  await login();
  database.listHistory.mockResolvedValue([]);
  await act(async () => { emit({ user: { id: 'account-b', email: 'b@example.test' } }); });
  await act(async () => { finishOldRead([{ id: 1, sequence: 'PRIVATE_OLD_ACCOUNT' }]); });
  expect(text()).not.toContain('PRIVATE_OLD_ACCOUNT');
  expect(text()).toContain('b@example.test');
});

test('manual download writes a batch and renders the refreshed local table', async () => {
  const { client, database } = fixtures();
  const pending = [{ data: [{ event_id: '00000000-0000-4000-8000-000000000001',
    received_at: '2026-09-16T00:00:00Z', master_id: 7, slave_id: 4,
    seq: 1, payload: { slaveId: 4 }, rssi: -80, snr: 5 }] }, { data: [] }];
  const query = {};
  for (const key of ['select', 'gte', 'lt', 'order', 'limit', 'or']) query[key] = () => query;
  query.abortSignal = async () => pending.shift();
  client.from = jest.fn(() => query);
  await act(async () => { renderer = Renderer.create(<CloudScreen database={database} clientFactory={() => client} />); });
  await login();
  await press('下載到手機');
  expect(database.savePage).toHaveBeenCalledWith('account-a', [expect.objectContaining({ master_id: 7, slave_id: 4 })]);
  expect(text()).toContain('下載完成');
  expect(text()).toContain('ACCOUNT_A_ONLY');
});
