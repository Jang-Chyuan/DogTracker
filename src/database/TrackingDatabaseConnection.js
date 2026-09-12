import { NativeModules, Platform } from 'react-native';
import { open } from 'react-native-nitro-sqlite';

// Android must use ONE SQLite engine/owner for this file. Loading Android
// SQLite and Nitro's bundled SQLite against it in one process is unsafe.
// The native owner also serializes batches against BLE writes.
export function openTrackingDatabase() {
  if (Platform.OS !== 'android' || !NativeModules.BleBackground) {
    return open({ name: 'dogtracker.sqlite', location: 'databases' });
  }
  const native = NativeModules.BleBackground;
  if (!native.executeDatabase || !native.executeDatabaseBatch) {
    throw new Error('Android SQLite bridge 不完整，請重新安裝完整建置的 App。');
  }
  let closed = false;
  function requireOpen() {
    if (closed) throw new Error('Tracking database connection is closed');
  }
  return {
    async executeAsync(query, params = []) {
      requireOpen();
      return JSON.parse(await native.executeDatabase(query, JSON.stringify(params)));
    },
    async executeBatchAsync(commands) {
      requireOpen();
      await native.executeDatabaseBatch(JSON.stringify(commands));
    },
    close() {
      // Closing a JS reader must never close the active BLE service's DB.
      closed = true;
    },
  };
}
