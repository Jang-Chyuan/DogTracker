import { useCallback, useEffect, useRef } from 'react';
import { Alert, NativeModules, Platform } from 'react-native';
import { sharedBleService } from '../ble/sharedBle';
import { judgeSwitch, mismatchDialog, snapshotReceiver } from './ReceiverSwitch';

/**
 * Settings → 接收器 (S2): 中斷連線, 重新連線, and the watch over a receiver
 * D3 has just set up (ReceiverSwitch): until its first packet arrives, a
 * packet from another Master disconnects it and says so wherever the user
 * is. `receiverState` is the native state App polls; `onRescan(method)` opens
 * D3 again ('qr' or 'manual', the way the receiver was chosen).
 */
export function useReceiverControl({ receiverState, onRescan, ble = sharedBleService,
  native = Platform.OS === 'android' ? NativeModules.BleBackground : null }) {
  // { target, previous, session, method } while a receiver chosen in D3 has
  // not sent its first packet.
  const pending = useRef(null);
  const latest = useRef(receiverState);
  latest.current = receiverState;
  const rescan = useRef(onRescan);
  rescan.current = onRescan;

  const disconnect = useCallback(() => ble.disconnect(), [ble]);
  const reconnect = useCallback(() => native?.reconnect?.().catch(() => {}), [native]);

  // Puts `previous` back as the receiver this phone is set up for, switched
  // off (an empty one forgets the receiver). The shared BLE service lets go
  // of the attempt first, so its callbacks for the new Master cannot act on
  // the restored receiver's packets.
  const restore = useCallback(async previous => {
    ble.disconnect();
    try {
      await native?.restoreReceiver?.(previous?.deviceId || '', previous?.deviceName || '',
        previous?.serviceUuid || '', previous?.dataUuid || '', previous?.expectedMasterId || 0);
    } catch {
      // The receiver page shows whatever the service reports next.
    }
  }, [ble, native]);

  const fail = useCallback(async mismatch => {
    const { previous, method } = pending.current || {};
    pending.current = null;
    // Put the previous receiver back, switched off; on a first set up forget
    // the wrong one.
    await restore(previous);
    const dialog = mismatchDialog(mismatch, previous, method);
    Alert.alert(dialog.title, dialog.message, dialog.buttons.map(button => ({
      text: button.label,
      style: button.id === 'later' ? 'cancel' : 'default',
      onPress: () => {
        if (button.id === 'reconnect') native?.reconnect?.().catch(() => {});
        else if (button.id === 'rescan') rescan.current?.(method);
      },
    })), { cancelable: true });
  }, [native, restore]);

  /**
   * D3 set up Master `target` ('qr' or 'manual' chose it): watch its first
   * packet. `previous` is the receiver to put back if it is another Master
   * (a snapshotReceiver, or null on a first set up: forgotten); `session` the
   * native session before it, whose reports do not count. Without options
   * the receiver in use now is remembered.
   */
  const watchSwitch = useCallback((target, options = {}) => {
    pending.current = {
      target,
      previous: options.previous !== undefined ? options.previous : snapshotReceiver(latest.current),
      session: options.session !== undefined ? options.session : latest.current?.sessionId ?? null,
      method: options.method || 'qr',
    };
  }, []);
  // The JS side saw another Master's packet (non-native fallback).
  const reportMismatch = useCallback(mismatch => {
    if (pending.current) fail(mismatch);
  }, [fail]);

  useEffect(() => {
    if (!pending.current) return;
    const verdict = judgeSwitch(receiverState, pending.current.target, pending.current.session);
    if (verdict === 'matched') pending.current = null;
    else if (verdict !== 'pending') fail(verdict);
  }, [receiverState, fail]);

  return { disconnect, reconnect, restore, watchSwitch, reportMismatch };
}
