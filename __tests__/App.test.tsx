import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { mockDatabase } from '../__mocks__/react-native-nitro-sqlite';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import App from '../App';

test('the initial App reads its seeded Demo from SQLite, not from the writer result', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const connection = createMemoryConnection();
  mockDatabase.executeAsync.mockImplementation(connection.executeAsync);
  mockDatabase.executeBatchAsync.mockImplementation(
    connection.executeBatchAsync,
  );
  let renderer: Renderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = Renderer.create(<App />);
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('DEMO · 模擬資料');
    expect(
      connection.sqlite
        .prepare('SELECT COUNT(*) AS count FROM demo_dog_status')
        .get().count,
    ).toBe(3);
    expect(
      mockDatabase.executeAsync.mock.calls.map(([sql]) => sql),
    ).toContainEqual(
      expect.stringContaining('SELECT * FROM demo_dog_status ORDER BY id DESC'),
    );
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    connection.close();
  }
});
