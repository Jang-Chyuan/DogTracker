import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { mockDatabase } from 'react-native-nitro-sqlite';
import App from '../App';
import { dogStatusRow } from '../__fixtures__/TrackingPointFixtures';

test('hardware diagnostics read SQLite and preserve upstream scanning', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockDatabase.executeAsync.mockImplementation(async (sql: string) => ({
    results: sql.includes('SELECT *') ? [dogStatusRow] : [],
  }));
  let renderer: Renderer.ReactTestRenderer;
  await act(async () => { renderer = Renderer.create(<App />); });
  expect(JSON.stringify(renderer!.toJSON())).toContain('自動 BLE QR Code 掃描');
  expect(mockDatabase.executeAsync.mock.calls.map(([sql]) => sql)).toContainEqual(expect.stringContaining('SELECT *'));
  await act(async () => renderer!.unmount());
});
