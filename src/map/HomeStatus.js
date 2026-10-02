// What the home map says about the receiver and cloud sync. Pure: the hooks
// feed in the native receiver state and the cloud sync state, and the clock.
//
// Nothing is shown while everything works; a pill appears only when the
// handler should know something (not connected, no data, sync failing). No
// counting seconds: a ticking number pulls the eye away from the dogs, so a
// past moment is written as its clock time.
//
// tone: 'warn' | 'crit' | 'idle'. Every tone carries words; colour only
// repeats them. First waiting, signed out and a stop the user chose are never
// shown as a disconnection.

// A receiver that is connected but quiet for this long is "no new data".
export const RECEIVER_QUIET_MS = 30000;
// Sync runs every 30 s in the foreground; two missed rounds is "late".
export const CLOUD_LATE_MS = 2 * 60000;

export function formatClock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Which receiver this phone is set up for: the Master ID from its QR code
// (the service stops on packets from any other Master), or, from an older
// build that does not report it, the number at the end of the device name.
export function receiverNumber(state) {
  if (state?.expectedMasterId > 0) return state.expectedMasterId;
  const number = /(\d+)\s*$/.exec(state?.deviceName || '')?.[1];
  return number ? Number(number) : null;
}

// "DogGPS-Master7" → "接收器 7"; a name without a number stays generic.
export function receiverName(deviceName, expectedMasterId) {
  const number = receiverNumber({ deviceName, expectedMasterId });
  return number != null ? `接收器 ${number}` : '接收器';
}

const HIDDEN = { show: false, tone: null, label: null, alert: null };

export function describeReceiver(state, now) {
  if (!state || !state.enabled) {
    return { show: true, tone: 'idle', label: '接收器｜未連接', alert: null };
  }
  const name = receiverName(state.deviceName, state.expectedMasterId);
  const last = state.lastReceivedAt > 0 ? state.lastReceivedAt : null;
  if (!state.running) {
    return {
      show: true,
      tone: 'crit',
      label: `${name}｜已停止`,
      alert: { title: `${name} 已停止接收`, detail: '背景接收沒有在執行' },
    };
  }
  if (!state.connected) {
    // Never received anything yet: still connecting, not a disconnection.
    if (!last) return { show: true, tone: 'warn', label: `${name}｜連線中`, alert: null };
    // The service keeps no disconnect time, so say what is known: the last packet.
    return {
      show: true,
      tone: 'crit',
      label: `${name}｜斷線`,
      alert: { title: `${name} 已斷線`, detail: `最後收訊 ${formatClock(last)}・會自動重連` },
    };
  }
  // The native flag decides whether data is flowing; after a quick reconnect
  // the old timestamp alone would look healthy.
  if (!state.receiving || !last || now - last > RECEIVER_QUIET_MS) {
    return { show: true, tone: 'warn', label: `${name}｜已連線・無新資料`, alert: null };
  }
  return HIDDEN;
}

export function describeCloud({ ownerId, error, lastSuccess } = {}, now) {
  if (!ownerId) return { show: true, tone: 'idle', label: '雲端｜需登入' };
  if (error) return { show: true, tone: 'warn', label: '雲端｜同步失敗' };
  if (lastSuccess && now - lastSuccess > CLOUD_LATE_MS) {
    return { show: true, tone: 'warn', label: `雲端｜最後同步 ${formatClock(lastSuccess)}` };
  }
  // Synced, syncing or about to: nothing to say.
  return { show: false, tone: null, label: null };
}
