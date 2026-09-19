import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import CloudScreen, { formatRaw } from '../src/cloud/CloudScreen';

const RAW = JSON.stringify({
  event_id: 'e', master_id: 7, slave_id: 4, received_at: '2026-09-18T12:00:00Z',
  payload: { lat: 25000000, lon: 121000000, speed: 300 },
});
const row = (id, extra = {}) => ({
  id, received_at: Date.parse('2026-09-18T12:00:00Z'), master_id: 7, slave_id: 4,
  slave_lat: 25, slave_lon: 121, speed_kmh: 3, battery_percentage: 80,
  raw_payload: RAW, ...extra,
});

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
    initialize: jest.fn(async () => {}), count: jest.fn(async () => 2),
    listHistory: jest.fn(async () => [row(1), row(2, { raw_payload: null })]),
    savePage: jest.fn(async () => {}),
  };
  return { client, database };
}
const text = () => JSON.stringify(renderer.toJSON());
async function login() {
  await act(async () => {
    renderer.root.findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === 'Email')
      .props.onChangeText('user@example.test');
    renderer.root.findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === '密碼')
      .props.onChangeText('test-only-password');
  });
  const button = renderer.root.findAll(node => node.props.accessibilityRole === 'button' &&
    node.props.accessibilityLabel === '登入' && typeof node.props.onPress === 'function')[0];
  await act(async () => { await button.props.onPress(); });
}

test('the raw record is readable, and says so when a row has none', () => {
  // The mapped columns only carry what the app reads; the question "does the
  // payload hold anything else, such as the Master's own position" needs this.
  expect(formatRaw(RAW)).toContain('"payload"');
  expect(formatRaw(RAW)).toContain('"lat": 25000000');
  expect(formatRaw(null)).toContain('沒有保留原始紀錄');
  expect(formatRaw('not json')).toBe('not json');
});

test('tapping a row opens its original cloud JSON, and tapping again closes it', async () => {
  const { client, database } = fixtures();
  await act(async () => {
    renderer = Renderer.create(
      <CloudScreen database={database} clientFactory={() => client} />);
  });
  await login();
  const open = id => renderer.root.findAll(
    node => node.props.accessibilityLabel === `第 ${id} 筆原始資料`, { deep: false })[0];
  expect(open(1)).toBeDefined();
  expect(text()).not.toContain('原始雲端紀錄');
  await act(async () => open(1).props.onPress());
  expect(text()).toContain('原始雲端紀錄');
  expect(text()).toContain('payload');
  await act(async () => open(1).props.onPress());
  expect(text()).not.toContain('原始雲端紀錄');
  // A row downloaded by an older version kept no raw record, and says so.
  await act(async () => open(2).props.onPress());
  expect(text()).toContain('沒有保留原始紀錄');
});
