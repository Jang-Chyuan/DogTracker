import { useCallback, useEffect, useRef } from 'react';
import { Alert, NativeModules, Platform } from 'react-native';
import { sharedBleService } from '../ble/sharedBle';
import { judgeSwitch, mismatchDialog, snapshotReceiver } from './ReceiverSwitch';

/**
 * Settings → 接收器 (S2): 中斷連線, 重新連線, and the watch over a change of
 * receiver (ReceiverSwitch). `receiverState` is the native state App polls;
 * `onRescan` opens the QR scan again.
 */
export function useReceiverControl({ receiverState, onRescan, ble = sharedBleService,
  native = Platform.OS === 'android' ? NativeModules.BleBackground : null }) {
  // { target, previous, session } while a QR-chosen receiver has not sent its first packet.
  const pending = useRef(null);
  const latest = useRef(receiverState);
  latest.current = receiverState;
  const rescan = useRef(onRescan);
  rescan.current = onRescan;

  const disconnect = useCallback(() => ble.disconnect(), [ble]);
  const reconnect = useCallback(() => native?.reconnect?.().catch(() => {}), [native]);

  const fail = useCallback(async mismatch => {
    const { previous } = pending.current || {};
    pending.current = null;
    // Put the previous receiver back, switched off; on a first set up forget
    // the wrong one.
    try {
      await native?.restoreReceiver?.(previous?.deviceId || '', previous?.deviceName || '',
        previous?.serviceUuid || '', previous?.dataUuid || '', previous?.expectedMasterId || 0);
    } catch {
      // The receiver page shows whatever the service reports next.
    }
    const dialog = mismatchDialog(mismatch, previous);
    Alert.alert(dialog.title, dialog.message, dialog.buttons.map(button => ({
      text: button.label,
      style: button.id === 'later' ? 'cancel' : 'default',
      onPress: () => {
        if (button.id === 'reconnect') native?.reconnect?.().catch(() => {});
        else if (button.id === 'rescan') rescan.current?.();
      },
    })), { cancelable: true });
  }, [native]);

  // A QR code chose Master `target`: remember what to put back.
  const watchSwitch = useCallback(target => {
    pending.current = { target, previous: snapshotReceiver(latest.current),
      session: latest.current?.sessionId ?? null };
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

  return { disconnect, reconnect, watchSwitch, reportMismatch };
}
