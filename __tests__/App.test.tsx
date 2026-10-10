import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { mockDatabase } from '../__mocks__/react-native-nitro-sqlite';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import App from '../App';
import TrackingMap from '../src/map/TrackingMap';
import { createDogDatabase } from '../src/database/DogDatabase';
import * as CloudDogs from '../src/cloud/useCloudDogs';

let mockAuthUser: { id: string } | null = { id: 'test-account' };
jest.mock('../src/cloud/useCloudSync', () => ({
  useCloudSync: () => ({ ownerId: null, busy: false, revision: 0, mapSuccessRevision: 0 }),
}));

jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ loading: false, user: mockAuthUser }),
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
    // No dog, no card: the live map shows no simulated position either.
    expect(renderer!.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
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


test('signed-out App with initial cloud generation zero still draws stored local dogs', async () => {
  mockAuthUser = null;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  await connection.executeAsync(`INSERT INTO dog_status
    (received_at, master_id, slave_id, slave_lat, slave_lon)
    VALUES (?, 3, 7, 25.03, 121.33)`, [Date.now()]);
  mockDatabase.executeAsync.mockImplementation(connection.executeAsync);
  mockDatabase.executeBatchAsync.mockImplementation(connection.executeBatchAsync);
  let renderer: Renderer.ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = Renderer.create(<App />); });
    const dogs = renderer!.root.findByType(TrackingMap).props.presentation.dogMarkers;
    expect(dogs.find((dog: { slaveId: number }) => dog.slaveId === 7)).toMatchObject({
      coordinate: { latitude: 25.03, longitude: 121.33 },
    });
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    connection.close();
    mockAuthUser = { id: 'test-account' };
  }
});


test('signed-out App retains a local receiver dog when the cloud reader is unavailable', async () => {
  mockAuthUser = null;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  await connection.executeAsync(`INSERT INTO dog_status
    (received_at, master_id, slave_id, slave_lat, slave_lon)
    VALUES (?, 3, 7, 25.03, 121.33)`, [Date.now()]);
  mockDatabase.executeAsync.mockImplementation(connection.executeAsync);
  mockDatabase.executeBatchAsync.mockImplementation(connection.executeBatchAsync);
  const cloudRead = jest.spyOn(CloudDogs, 'useCloudDogs').mockReturnValue({
    rows: [], packets: [], track: [], holds: {}, statuses: {}, ranges: {}, error: '', loaded: false,
  });
  let renderer: Renderer.ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = Renderer.create(<App />); });
    expect(renderer!.root.findByType(TrackingMap).props.presentation.dogMarkers.some(
      (dog: { slaveId: number }) => dog.slaveId === 7,
    )).toBe(true);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    cloudRead.mockRestore();
    connection.close();
    mockAuthUser = { id: 'test-account' };
  }
});
