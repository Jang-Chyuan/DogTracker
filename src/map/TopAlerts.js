// What the live map says above itself, and what lights the settings gear's
// red dot (design v3 A2/A2b/A2c/A6, 「每一類問題放在哪裡」「每一種提醒」,
// 判定表「接收器斷線什麼時候算」「上方訊息的排列」「齒輪紅點」). Pure: MapScreen
// feeds in the receiver's native state, the storage and map states and what
// the user dismissed; the views (TopAlertCards, SettingsGear) only draw it.
//
// - Things to handle right now get a top card, in this order: 接收器斷線,
//   位置存不進手機, 地圖載入失敗 / 地圖打不開, A6 還沒有狗.
// - Things to handle in settings light the gear's red dot: the cloud failing,
//   permissions, the receiver's battery low, a receiver not found, and a
//   disconnection or storage card the user collapsed with ✕.
// - A dog's own problems stay on the dog (DogMarkers); nothing here.

import { receiverNumber } from './ReceiverState';
import { formatClock } from './MapFormat';

// A link that dropped counts as 斷線 once automatic reconnection has not
// brought it back for this long.
export const DISCONNECT_GRACE_MS = 30 * 1000;
// A receiver that has not connected since the app opened (it may be switched
// off) is 「連線中」; after this long it is 「找不到接收器」: the gear's red dot,
// never a card.
export const RECEIVER_MISSING_MS = 2 * 60 * 1000;
// The receiver's own battery at or under this is low (gear dot only).
export const RECEIVER_BATTERY_LOW = 20;

/**
 * The receiver disconnection the card is about, or null. Counts only a link
 * that was established in this service run (native disconnectedAt), dropped,
 * and has not come back for DISCONNECT_GRACE_MS. Not: no receiver set up, the
 * user's own 中斷連線 (the service is off), or never connected yet.
 * `key` tells one disconnection from the next (a ✕ is for this one only).
 */
export function receiverOutage(state, now) {
  // Not receiverLink's 'disconnected': a link can drop before its first
  // packet, and a packet stored by an earlier run says nothing about this one.
  if (!state?.enabled || !state.running || state.connected) return null;
  const since = Number(state.disconnectedAt);
  if (!(since > 0) || now - since < DISCONNECT_GRACE_MS) return null;
  return { key: since, since, number: receiverNumber(state) };
}

// "SQLITE_FULL", "database or disk is full", ENOSPC: the phone is out of space.
const FULL = /SQLITE_FULL|disk is full|no space left|ENOSPC|空間不足/i;

/** A failed write of dog positions to this phone, or null. */
export function storageProblem(error) {
  const reason = typeof error === 'string' ? error.trim() : '';
  if (!reason) return null;
  return { full: FULL.test(reason), reason };
}

/**
 * Remembers, while the map runs, when the receiver started waiting for its
 * first connection (or its service was not running), so 「找不到接收器」 waits
 * RECEIVER_MISSING_MS. Returns the next memory.
 */
export function trackReceiverWait(memory, state, now) {
  // Set up, but its service is not running, or it has not connected in this
  // service run (no disconnectedAt): waiting, not disconnected.
  const waiting = !!state?.enabled && (!state.running
    || (!state.connected && !(Number(state.disconnectedAt) > 0)));
  if (!waiting) return { waitingSince: null, device: null };
  // Another receiver chosen meanwhile starts its own wait.
  const device = state.deviceId || state.deviceName || '';
  const same = memory?.waitingSince != null && memory.device === device;
  return { waitingSince: same ? memory.waitingSince : now, device };
}

/**
 * Whether A6 (還沒有狗) applies: no receiver set up and no dog data at all
 * (this phone's receiver or the cloud), once everything has been read. Goes
 * by itself when a receiver is set up (whether or not it has delivered) or a
 * dog appears; never again after its ✕.
 */
export function showsNoDogs({ receiverState, hasDogData, dataRead, dismissed }) {
  if (dismissed || !dataRead || receiverState === undefined) return false;
  const receiverSetUp = !!receiverState?.deviceId || !!receiverState?.enabled;
  return !receiverSetUp && !hasDogData;
}

/**
 * The top cards, top to bottom. Each: { id, kind: 'alert' | 'info', icon,
 * title, detail, action: { id, label, busy }, closable }.
 *  - outage: receiverOutage(); storage: storageProblem();
 *  - map: 'load-failed' | 'unavailable' | null, retrying: a retry is loading;
 *  - noDogs: showsNoDogs(); signedIn hides 「登入 Supabase」;
 *  - dismissed: { receiver: outage key, storage: true }.
 */
export function topCards({ outage = null, storage = null, map = null, retrying = false, noDogs = false,
  signedIn = false, dismissed = {}, waitingSources = 0 }) {
  const cards = [];
  if (outage && dismissed.receiver !== outage.key) {
    cards.push({
      id: 'receiver', kind: 'alert', icon: 'receiver-off',
      title: outage.number != null ? `接收器 ${outage.number} 斷線了` : '接收器斷線了',
      detail: `${formatClock(outage.since)} 斷線・正在自動重連`,
      actions: [{ id: 'receiver-settings', label: '接收器設定' }],
      closable: true,
    });
  }
  if (storage && !dismissed.storage) {
    cards.push({
      id: 'storage', kind: 'alert', icon: 'storage',
      title: '位置存不進手機',
      detail: storage.full ? '手機空間不足' : storage.reason,
      actions: [storage.full ? { id: 'storage-settings', label: '檢查空間' } : { id: 'storage-reason', label: '看原因' }],
      closable: true,
    });
  }
  if (map === 'load-failed' || map === 'unavailable') {
    cards.push({
      id: 'map', kind: 'alert', icon: 'map-off',
      title: map === 'unavailable' ? '地圖打不開' : '地圖載入失敗',
      detail: map === 'unavailable' ? '狗的位置還是會照常收、照常提醒' : '沒有網路或地圖服務連不上',
      actions: [{ id: 'map-retry', label: retrying ? '載入中…' : '重試', busy: retrying }],
      closable: false,
    });
  }
  if (waitingSources > 0) {
    cards.push({ id: 'waiting-sources', kind: 'info', icon: 'locate',
      title: `${waitingSources} 個訊號源等待定位`,
      detail: '定位後狗會出現在地圖上；點這裡看訊號源',
      label: `${waitingSources} 個訊號源等待定位，定位後狗會出現在地圖上，點兩下看訊號源`,
      tapAction: 'waiting-source-settings', closeLabel: '關閉等待定位提示', actions: [], closable: true });
  } else if (noDogs) {
    cards.push({
      id: 'no-dogs', kind: 'info', icon: 'dog',
      title: '還沒有狗的資料',
      detail: '連上接收器或登入 Supabase，狗就會出現在地圖上；只用「我的路線」也可以',
      actions: [
        { id: 'connect-receiver', label: '連接接收器' },
        ...(signedIn ? [] : [{ id: 'sign-in', label: '登入 Supabase', quiet: true }]),
      ],
      closable: true,
    });
  }
  return cards;
}

/**
 * What lights the gear's red dot, as a list of reasons (TalkBack counts
 * them: 「設定，有 2 件事要處理」). A card still showing adds nothing; the
 * same problem collapsed with ✕ does. A6's ✕ never does.
 */
export function gearReasons({ outage = null, storage = null, dismissed = {}, receiverState = null,
  receiverWait = null, receiverBattery = null, cloudFailing = false, signInExpired = false,
  phone = null, notificationsDenied = false, nearbyDenied = false, now }) {
  const reasons = [];
  if (outage && dismissed.receiver === outage.key) reasons.push('receiver-disconnected');
  if (storage && dismissed.storage) reasons.push('storage');
  if (receiverWait?.waitingSince != null && now - receiverWait.waitingSince >= RECEIVER_MISSING_MS
    && receiverState?.enabled) reasons.push('receiver-missing');
  if (receiverState?.enabled && receiverBattery?.valid && Number.isFinite(receiverBattery.percentage)
    && receiverBattery.percentage <= RECEIVER_BATTERY_LOW) reasons.push('receiver-battery');
  if (cloudFailing || signInExpired) reasons.push('cloud');
  const permission = phone?.permission;
  if (permission && permission !== 'checking' && permission !== 'unsupported' && !phone?.busy
    && (permission !== 'precise' || !phone.services)) reasons.push('phone-location');
  if (notificationsDenied) reasons.push('notifications');
  // 附近的裝置 (Android 12+): without it the receiver cannot be reached.
  if (nearbyDenied) reasons.push('nearby-devices');
  return reasons;
}

/** The gear's TalkBack label. */
export function gearLabel(reasons) {
  return reasons.length ? `設定，有 ${reasons.length} 件事要處理` : '設定';
}
