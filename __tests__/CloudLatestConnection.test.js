import { NativeModules, Platform } from 'react-native';
import { open } from 'react-native-nitro-sqlite';
import { openCloudLatestDatabase } from '../src/database/CloudLatestConnection';
import { openTrackingDatabase } from '../src/database/TrackingDatabaseConnection';

const os = Platform.OS;
afterEach(() => { delete NativeModules.BleBackground; Platform.OS = os; jest.clearAllMocks(); });

test('Android latest bridge routes typed SQL and atomic batches independently of archive native work and shares only its own native lock', async () => {
  Platform.OS = 'android';
  const native = { executeDatabase: jest.fn(async () => '{"results":[]}'), executeDatabaseBatch: jest.fn(),
    executeLatestDatabase: jest.fn(async () => '{"results":[{"revision":3,"fix":null}]}'), executeLatestDatabaseBatch: jest.fn(async () => true) };
  NativeModules.BleBackground = native;
  const archive = openTrackingDatabase(), first = openCloudLatestDatabase(), second = openCloudLatestDatabase();
  expect(first.lockKey).toBe(second.lockKey); expect(first.lockKey).not.toBe(archive.lockKey);
  expect(await first.executeAsync('SELECT ?', [null, 25.123, '中文', true])).toEqual({ results: [{ revision: 3, fix: null }] });
  expect(native.executeLatestDatabase).toHaveBeenCalledWith('SELECT ?', '[null,25.123,"中文",true]');
  const commands = [{ query: 'DELETE FROM cloud_latest_snapshot', params: [] }]; await first.executeBatchAsync(commands);
  expect(native.executeLatestDatabaseBatch).toHaveBeenCalledWith(JSON.stringify(commands));
  expect(native.executeDatabase).not.toHaveBeenCalled(); expect(native.executeDatabaseBatch).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  first.close(); await expect(first.executeAsync('SELECT 1')).rejects.toThrow('closed');
  await expect(first.executeBatchAsync([])).rejects.toThrow('closed');
  expect(await second.executeAsync('SELECT 1')).toEqual({ results: [{ revision: 3, fix: null }] });
});

test('missing new Android methods fail closed rather than falling back to archive or a second SQLite engine', () => {
  Platform.OS = 'android'; NativeModules.BleBackground = { executeDatabase: jest.fn(), executeDatabaseBatch: jest.fn() };
  expect(openCloudLatestDatabase).toThrow('bridge'); expect(open).not.toHaveBeenCalled();
});

test('missing Android native owner also fails closed without opening Nitro on the framework-owned latest file', () => {
  Platform.OS = 'android'; delete NativeModules.BleBackground;
  expect(openCloudLatestDatabase).toThrow('bridge'); expect(open).not.toHaveBeenCalled();
});

test('non-Android latest fallback opens a different physical file', () => {
  Platform.OS = 'ios'; openCloudLatestDatabase();
  expect(open).toHaveBeenCalledWith({ name: 'dogtracker-latest.sqlite', location: 'databases' });
});
