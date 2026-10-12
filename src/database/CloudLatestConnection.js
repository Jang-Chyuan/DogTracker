import { NativeModules, Platform } from 'react-native';
import { open } from 'react-native-nitro-sqlite';
const androidLatestLockKey = {};

// Android-framework SQLite owns this file, just as it owns dogtracker.sqlite.
// It never borrows the archive's executor, monitor, connection or JS lock.
export function openCloudLatestDatabase() {
  if (Platform.OS !== 'android')
    return open({ name: 'dogtracker-latest.sqlite', location: 'databases' });
  const native = NativeModules.BleBackground;
  if (!native?.executeLatestDatabase || !native?.executeLatestDatabaseBatch)
    throw new Error('Latest SQLite bridge is unavailable');
  let closed = false;
  const requireOpen = () => { if (closed) throw new Error('Latest database connection is closed'); };
  return {
    lockKey: androidLatestLockKey,
    async executeAsync(query, params = []) {
      requireOpen();
      return JSON.parse(await native.executeLatestDatabase(query, JSON.stringify(params)));
    },
    async executeBatchAsync(commands) {
      requireOpen(); await native.executeLatestDatabaseBatch(JSON.stringify(commands));
    },
    close() { closed = true; },
  };
}
