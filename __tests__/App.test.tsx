import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { mockDatabase } from '../__mocks__/react-native-nitro-sqlite';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import App from '../App';

jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ loading: false, user: { id: 'test-account' } }),
}));

test('a fresh App reads real SQLite and never creates simulated positions', async () => {
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
    expect(JSON.stringify(renderer!.toJSON())).toContain('等待硬體資料');
    expect(
      connection.sqlite
        .prepare('SELECT COUNT(*) AS count FROM dog_status')
        .get().count,
    ).toBe(0);
    expect(
      mockDatabase.executeAsync.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim()),
    ).toContainEqual(
      expect.stringContaining('SELECT * FROM dog_status ORDER BY id DESC'),
    );
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    connection.close();
  }
});
