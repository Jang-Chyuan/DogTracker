import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { AuthProvider } from '../src/auth/AuthProvider';
import CloudDataScreen, { formatRaw } from '../src/cloud/CloudDataScreen';

const RAW = JSON.stringify({
  event_id: 'e', master_id: 7, slave_id: 4, received_at: '2026-09-18T12:00:00Z',
  payload: { lat: 25000000, lon: 121000000, speed: 300 },
});
const row = (id, extra = {}) => ({
  id, received_at: Date.parse('2026-09-18T12:00:00Z'), master_id: 7, slave_id: 4,
  slave_lat: 25, slave_lon: 121, speed_kmh: 3, battery_percentage: 80,
  raw_payload: RAW, usb_present: 1, ...extra,
});

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
    initialize: jest.fn(async () => {}), count: jest.fn(async () => 2),
    // The page also reports what the downloaded copy costs this phone.
    usage: jest.fn(async () => ({ rows: 2, bytes: 1120, budget: 500 * 1024 * 1024, from: 1 })),
    listHistory: jest.fn(async () => [row(1), row(2, { raw_payload: null })]),
    savePage: jest.fn(async () => {}),
  };
  return { client, database };
}
const text = () => JSON.stringify(renderer.toJSON());
async function login() {
  await act(async () => { await lastClient.auth.signInWithPassword(); });
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
    renderer = withAuth(
      <CloudDataScreen database={database} clientFactory={() => client} />);
  });
  await login();
  const open = id => renderer.root.findAll(
    node => node.props.accessibilityLabel === `第 ${id} 筆原始資料`, { deep: false })[0];
  expect(open(1)).toBeDefined();
  expect(text()).toContain('usb_present');
  expect(open(1).findAllByType(Text).map(node => node.props.children)).toContain('1');
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
