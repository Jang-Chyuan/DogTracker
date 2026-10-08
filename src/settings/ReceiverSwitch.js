// Changing receivers from settings → 接收器 (S2 「掃 QR Code 換接收器」,
// 「中斷並重新掃描」), as far as the design's rules can be kept before D3
// (053): the receiver used until now is remembered when the QR code picks
// another one; if the new one turns out to be another Master (its first
// packet has the wrong number), the previous receiver is put back, switched
// off, and a dialog says so (判定表「換接收器時「先換過去」之後才發現編號不符」):
// 「這不是要連的接收器」「要連 8，收到的是 3，已中斷連線，改回接收器 7（已中斷連線）」
// with 「連線接收器 7」 / 「重新掃描」. Pure; useReceiverControl does the rest.

import { receiverNumber } from '../map/ReceiverState';

/** The receiver this phone is set up for, to put back later; null if none. */
export function snapshotReceiver(state) {
  if (!state?.deviceId) return null;
  return {
    deviceId: state.deviceId,
    deviceName: state.deviceName || '',
    serviceUuid: state.serviceUuid || '',
    dataUuid: state.dataUuid || '',
    expectedMasterId: Number(state.expectedMasterId) || 0,
    number: receiverNumber(state),
  };
}

// The native service stops on a packet from another Master with this status
// (BleForegroundService: 「Master ID 不符合：QR=8，BLE=3」).
const MISMATCH = /Master ID 不符合：QR=(\d+)，BLE=(\d+)/;

/**
 * Where a change to Master `target` stands, judged from the receiver's
 * native state: 'pending' until the first packet, 'matched' once one arrived
 * from that Master, or { expected, got } when another Master answered.
 * `session` is the service session before the change: nothing it reported
 * counts.
 */
export function judgeSwitch(state, target, session = null) {
  if (!state || !(target > 0)) return 'pending';
  if (session != null && state.sessionId === session) return 'pending';
  const wrong = MISMATCH.exec(state.lastStatus || '');
  if (!state.enabled && wrong && Number(wrong[1]) === target) {
    return { expected: Number(wrong[1]), got: Number(wrong[2]) };
  }
  if (state.enabled && Number(state.expectedMasterId) === target && Number(state.lastReceivedAt) > 0) {
    return 'matched';
  }
  return 'pending';
}

/**
 * The dialog after another Master answered. `previous` is the snapshot of
 * the receiver used before (put back, switched off), or null on a first set
 * up (nothing to put back: the wrong receiver is forgotten).
 */
export function mismatchDialog({ expected, got }, previous) {
  const back = previous?.number ?? null;
  if (back != null) {
    return {
      title: '這不是要連的接收器',
      message: `要連 ${expected}，收到的是 ${got}，已中斷連線，改回接收器 ${back}（已中斷連線）`,
      buttons: [{ id: 'reconnect', label: `連線接收器 ${back}` }, { id: 'rescan', label: '重新掃描' }],
    };
  }
  return {
    title: '這不是要連的接收器',
    message: `要連 ${expected}，收到的是 ${got}，已中斷連線`,
    buttons: [{ id: 'later', label: '稍後再說' }, { id: 'rescan', label: '重新掃描' }],
  };
}
