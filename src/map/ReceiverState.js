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

/**
 * The last time the user disconnected this phone's receiver, for
 * DogFreshness (判定表「中斷連線時的狀態」): while it is switched off its dogs
 * do not go stale, and after it is back they get a grace period.
 *
 * Fed with every receiver state the map reads; returns the next record
 * { running, pausedAt, resumedAt } (pausedAt null: never paused). Switching
 * the background service off ('stopped', 'none') after it ran is the user
 * disconnecting; a dropped link ('disconnected') is not. The record is kept in
 * memory only: a restarted app judges by the plain formula.
 */
export function trackReceiverPause(record, state, now) {
  const current = record || { running: false, pausedAt: null, resumedAt: null };
  // No state read (inactive map, failed read): nothing is known.
  if (!state) return current;
  const link = receiverLink(state, now);
  if (link === 'stopped' || link === 'none') {
    if (!current.running) return current;
    return { running: false, pausedAt: now, resumedAt: null };
  }
  const connected = link === 'receiving' || link === 'quiet';
  const resumed = connected && current.pausedAt != null && current.resumedAt == null;
  if (current.running && !resumed) return current;
  return { running: true, pausedAt: current.pausedAt, resumedAt: resumed ? now : current.resumedAt };
}
