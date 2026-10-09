import { logger } from '../logger';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getDeviceProfile } from '../config/DeviceProfiles';
import { sharedBleService } from './sharedBle';

const POLL_MS = 2000;

/**
 * The receiver's background work that does not belong to a page (it was
 * HardwareScreen's until D3 replaced that page): it takes over the BLE
 * service the native side may already run (restoreBackground), stores packets
 * the JS side receives itself (only without the native service, which stores
 * its own: `persistedNatively`), and reports the native service's storage
 * error every POLL_MS (the map's 「位置存不進手機」, S8). Mounted once the
 * database is open.
 *
 * Returns { receiveData, onStatus }: the handlers a new connection (D3) hands
 * the service, so its packets are stored the same way.
 */
export function useReceiverService({ dogDatabase, enabled = true, onStorageError, ble = sharedBleService }) {
  const databaseReady = useRef(null);
  const lastSaved = useRef(new Map());
  const database = useRef(dogDatabase);
  database.current = dogDatabase;
  const report = useRef(onStorageError);
  report.current = onStorageError;

  const receiveData = useCallback((nextData, payload, metadata) => {
    if (metadata?.persistedNatively) return;
    const slaveId = Number(nextData?.slaveId);
    if (!Number.isInteger(slaveId) || slaveId <= 0) return;
    const now = Date.now();
    if (now - (lastSaved.current.get(slaveId) ?? 0) < getDeviceProfile('default').databaseSaveIntervalMs) return;
    lastSaved.current.set(slaveId, now);
    databaseReady.current
      ?.then(() => database.current.saveStatus(nextData, payload))
      .catch(error => logger.error('儲存 BLE 資料失敗', error));
  }, []);
  const onStatus = useCallback(() => {}, []);

  useEffect(() => {
    if (!enabled || !dogDatabase) return;
    databaseReady.current = dogDatabase.initialize();
    databaseReady.current.catch(error => logger.error('SQLite 初始化失敗', error));
    ble.restoreBackground(onStatus, receiveData)
      .catch(error => logger.error('恢復背景 BLE 狀態失敗', error));
  }, [ble, dogDatabase, enabled, onStatus, receiveData]);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let reading = false;
    const refresh = async () => {
      if (reading || AppState.currentState !== 'active') return;
      reading = true;
      try {
        const state = await ble.getBackgroundState();
        if (!disposed && state) report.current?.(state.storageError || null);
      } catch (error) {
        logger.error('讀取背景狀態失敗', error);
      } finally {
        reading = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [ble, enabled]);

  return { receiveData, onStatus };
}
