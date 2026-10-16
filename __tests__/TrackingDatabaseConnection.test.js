import { NativeModules, Platform } from 'react-native';
import { open } from 'react-native-nitro-sqlite';
import { openTrackingDatabase } from '../src/database/TrackingDatabaseConnection';

const os = Platform.OS;
afterEach(() => { delete NativeModules.BleBackground; Platform.OS = os; jest.clearAllMocks(); });
test('Android uses a single native engine for typed parameters, reads and batches', async () => {
  Platform.OS = 'android';
  const native = {
    executeDatabase: jest.fn(async () => '{"results":[{"id":7,"master_lat":null}],"insertId":8}'),
    executeDatabaseBatch: jest.fn(async () => true),
  };
  NativeModules.BleBackground = native;
  const db = openTrackingDatabase();
  expect(await db.executeAsync('SELECT ?', [null, 25.123, '中文', true])).toEqual({
    results: [{ id: 7, master_lat: null }], insertId: 8,
  });
  expect(native.executeDatabase).toHaveBeenCalledWith('SELECT ?', '[null,25.123,"中文",true]');
  const commands = [{ query: 'DELETE FROM app_settings' }, { query: 'INSERT INTO app_settings VALUES (?)', params: [42] }];
  await db.executeBatchAsync(commands);
  expect(native.executeDatabaseBatch).toHaveBeenCalledWith(JSON.stringify(commands));
  expect(open).not.toHaveBeenCalled();
  db.close();
  await expect(db.executeAsync('SELECT 1')).rejects.toThrow('closed');
  await expect(db.executeBatchAsync([])).rejects.toThrow('closed');
});
test('an incomplete Android bridge fails closed instead of opening Nitro on the native file', () => {
  Platform.OS = 'android';
  NativeModules.BleBackground = { initializeDatabase: jest.fn() };
  expect(openTrackingDatabase).toThrow('bridge');
  expect(open).not.toHaveBeenCalled();
});
test('non-Android retains the Nitro fallback', () => {
  Platform.OS = 'ios';
  openTrackingDatabase();
  expect(open).toHaveBeenCalledWith({ name: 'dogtracker.sqlite', location: 'databases' });
});
test('Android: my route\'s SELECTs have their own read lane, when the bridge has one', async () => {
  Platform.OS = 'android';
  const native = {
    executeDatabase: jest.fn(async () => '{"results":[]}'),
    executeDatabaseBatch: jest.fn(async () => true),
    readDatabase: jest.fn(async () => '{"results":[{"n":3}]}'),
  };
  NativeModules.BleBackground = native;
  const db = openTrackingDatabase();
  expect(await db.reader.executeAsync('SELECT COUNT(*) AS n FROM myLocationTracker WHERE id > ?', [5]))
    .toEqual({ results: [{ n: 3 }] });
  expect(native.readDatabase).toHaveBeenCalledWith('SELECT COUNT(*) AS n FROM myLocationTracker WHERE id > ?', '[5]');
  expect(native.executeDatabase).not.toHaveBeenCalled();
  db.close();
  await expect(db.reader.executeAsync('SELECT 1')).rejects.toThrow('closed');
  // An older native module without the lane: no reader, everything on the one queue.
  delete native.readDatabase;
  expect(openTrackingDatabase().reader).toBeNull();
});
