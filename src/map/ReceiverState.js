// What the app knows about the receiver it is set up for. Pure: useReceiverState
// feeds in BleBackground.getState() (or a debug screen fixture), and the clock.

// A receiver that is connected but quiet for this long has no new data.
export const RECEIVER_QUIET_MS = 30000;

// Which receiver this phone is set up for: the Master ID from its QR code
// (the background service stops on packets from any other Master), or, from
// an older build that does not report it, the number at the end of the
// device name ("DogGPS-Master7" → 7). null when neither says.
export function receiverNumber(state) {
  if (state?.expectedMasterId > 0) return state.expectedMasterId;
  const number = /(\d+)\s*$/.exec(state?.deviceName || '')?.[1];
  return number ? Number(number) : null;
}

/**
 * The receiver link as one word:
 * - 'none'          no receiver set up (or reception switched off)
 * - 'stopped'       set up, but the background service is not running
 * - 'connecting'    running, never received anything yet (not a disconnection)
 * - 'disconnected'  running, received before, connection lost
 * - 'quiet'         connected, no packet for RECEIVER_QUIET_MS
 * - 'receiving'     connected and packets are arriving
 */
export function receiverLink(state, now) {
  if (!state || !state.enabled) return 'none';
  if (!state.running) return 'stopped';
  const last = state.lastReceivedAt > 0 ? state.lastReceivedAt : null;
  if (!state.connected) return last ? 'disconnected' : 'connecting';
  // The native flag decides whether data is flowing; after a quick reconnect
  // the old timestamp alone would look healthy.
  if (!state.receiving || !last || now - last > RECEIVER_QUIET_MS) return 'quiet';
  return 'receiving';
}

// The newest stored packet can come from a receiver used before this one
// (the current one has not sent anything yet). Its Master position is then
// not this receiver's and must not be drawn or framed as if it were.
export function isOtherReceiver(point, state) {
  const number = state ? receiverNumber(state) : null;
  return number != null && point?.id != null && point.masterId !== number;
}
