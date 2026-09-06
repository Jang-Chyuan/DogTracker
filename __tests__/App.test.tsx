/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {mockDatabase} from 'react-native-nitro-sqlite';
import {AppState} from 'react-native';
import App from '../App';
import {dogStatusRow} from '../__fixtures__/TrackingPointFixtures';

test('renders the latest tracking status read from SQLite', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  mockDatabase.executeAsync.mockImplementation(async (sql: string) => {
    if (sql.includes('PRAGMA table_info')) {
      return {results: [{name: 'master_id'}, {name: 'slave_id'}]};
    }
    if (sql.includes('SELECT *') && sql.includes('ORDER BY id DESC')) {
      return {results: [dogStatusRow]};
    }
    return {insertId: 1, results: []};
  });

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await new Promise(resolve => setImmediate(resolve));
  });

  expect(mockDatabase.executeAsync.mock.calls.map(([sql]) => sql)).toContainEqual(
    expect.stringContaining('ORDER BY id DESC'),
  );
  expect(JSON.stringify(renderer.toJSON())).toContain('Master ID: ');
  expect(JSON.stringify(renderer.toJSON())).toContain('SQLite');

  await ReactTestRenderer.act(async () => {
    renderer.unmount();
  });
});
