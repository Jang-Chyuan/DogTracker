// What the settings pages say (design v3 S1 設定首頁, S2 接收器, S4 手機;
// 判定表「設定首頁的分組」「設定裡的紅色「!」」「S4 的權限格」「忽略電池最佳化（S4）」
// 「中斷連線時的顯示」「A6 什麼時候出現」「沒取名字的訊號源」). Pure: App hands in
// the same inputs the map has (the receiver's native state, the newest
// packet, the phone, the permissions, the cloud) and the pages only draw the
// answer.
//
// A row of S1 has a red 「!」 exactly when the gear's red dot has a reason
// that belongs to it (TopAlerts.gearReasons): the receiver row for a receiver
// not found, disconnected or low on battery; 手機 for location permission,
// precise location, location services, nearby devices or notifications;
// Supabase 帳號 for the cloud failing or the sign-in expired; 提醒 for
// notifications. A card on the map that was not collapsed counts too: S1
// lists what needs handling, whatever the map shows.

import { gearReasons, receiverOutage, storageProblem } from '../map/TopAlerts';
import { isOtherReceiver, receiverNumber } from '../map/ReceiverState';
import { formatClock } from '../map/MapFormat';
import { alertsHomeStatus } from '../alerts/AlertPreferences';

const MINUTE = 60 * 1000;

/**
 * The settings pages' input from what App hands the map (after a screen
 * fixture, if any, replaced it): `inputs` as applyScreenFixture returns them,
 * plus the receiver's native state and wait, the clock and the 位置記錄
 * switch (a fixture brings its own).
 */
export function settingsInput(inputs, { now, receiverState, receiverWait = null, recording = null }) {
  const sync = inputs.cloudSync || {};
  return {
    now,
    receiverState,
    receiverWait,
    point: inputs.tracking?.point,
    packets: inputs.cloudDogs?.packets,
    aliases: inputs.history?.preferences?.dogAliases,
    phone: inputs.phone,
    permissions: inputs.permissions || {},
    recording: inputs.recording ?? recording ?? {},
    todayCount: inputs.todayRoute?.count ?? null,
    account: inputs.account || {},
    // S3: the download (useCloudSync) and upload (useCloudUpload) states.
    sync,
    upload: inputs.upload || {},
    cloudFailing: !!sync.ownerId && (sync.failingSince != null || !!inputs.cloudProblem),
    signInExpired: !!inputs.signInExpired,
    storage: storageProblem(inputs.tracking?.realWriteError),
    // 設定 → 提醒 (S6): the saved AlertPreferences.
    alerts: inputs.tracking?.preferences?.value?.alerts,
  };
}
// A connected receiver says 「N 分鐘沒有新資料」 once it has been quiet this
// long (判定表「A6 什麼時候出現」: 「滿 2 分鐘照「沒有新資料」」).
export const RECEIVER_SILENT_MS = 2 * MINUTE;

/** Whether this phone has a receiver set up (connected or not). */
export const receiverSetUp = state => !!state?.deviceId || !!state?.enabled;

/**
 * The receiver as the settings pages describe it:
 * - 'none'          no receiver set up
 * - 'off'           set up, the user pressed 中斷連線 (or a change failed)
 * - 'connecting'    set up, not connected in this run yet (or its service
 *                   is not running): 連線中
 * - 'missing'       the same for RECEIVER_MISSING_MS: 找不到接收器 7
 * - 'disconnected'  connected in this run, then lost for 30 s, reconnecting
 * - 'waiting'       connected, nothing received since it was chosen
 * - 'silent'        connected, nothing new for RECEIVER_SILENT_MS
 * - 'connected'     connected and delivering
 */
export function receiverPhase(state, reasons, now) {
  if (!receiverSetUp(state)) return 'none';
  if (!state.enabled) return 'off';
  if (reasons.includes('receiver-missing')) return 'missing';
  // Lost for DISCONNECT_GRACE_MS (TopAlerts.receiverOutage); before that it
  // is reconnecting: 連線中.
  if (reasons.includes('receiver-disconnected')) return 'disconnected';
  if (!state.running || !state.connected) return 'connecting';
  const last = Number(state.lastReceivedAt) > 0 ? Number(state.lastReceivedAt) : null;
  if (!last) return 'waiting';
  if (now - last >= RECEIVER_SILENT_MS) return 'silent';
  return 'connected';
}

/**
 * The gear's reasons with every card counted as collapsed: what S1 marks.
 * `input` is what settingsStatus takes.
 */
export function settingsReasons(input) {
  const { receiverState, receiverWait, point, phone, permissions = {}, cloudFailing = false,
    signInExpired = false, storage = null, now } = input;
  const outage = receiverOutage(receiverState, now);
  return gearReasons({
    outage, storage, dismissed: { receiver: outage?.key, storage: true }, receiverState, receiverWait,
    receiverBattery: receiverBattery(receiverState, point),
    cloudFailing, signInExpired, phone,
    notificationsDenied: !!permissions.notificationsDenied, nearbyDenied: !!permissions.nearbyDenied, now,
  });
}

// The receiver's own battery from the newest packet, unless that packet came
// from a receiver used before this one.
function receiverBattery(state, point) {
  if (!point || point.id == null || isOtherReceiver(point, state)) return null;
  return { valid: point.masterBatteryValid, percentage: point.masterBatteryPercentage };
}

const batteryText = battery => (battery?.valid && Number.isFinite(battery.percentage)
  ? `電量 ${Math.round(battery.percentage)}%` : null);

// What each reason is called when TalkBack reads a row with 「!」.
function reasonText(reason, input) {
  const number = receiverNumber(input.receiverState);
  const phone = input.phone || {};
  switch (reason) {
    case 'receiver-missing': return number != null ? `找不到接收器 ${number}` : '找不到接收器';
    case 'receiver-disconnected': return number != null ? `接收器 ${number} 斷線了` : '接收器斷線了';
    case 'receiver-battery': return '接收器電量低';
    case 'cloud': return input.signInExpired ? '需要重新登入' : '連不上';
    case 'phone-location':
      if (!['precise', 'approximate'].includes(phone.permission)) return '沒有定位權限';
      if (phone.permission === 'approximate') return '只給了大概位置';
      return '定位服務關著';
    case 'nearby-devices': return '附近的裝置未允許';
    case 'notifications': return '通知未允許';
    default: return '';
  }
}

const ROW_REASONS = {
  receiver: ['receiver-missing', 'receiver-disconnected', 'receiver-battery'],
  phone: ['phone-location', 'nearby-devices', 'notifications'],
  account: ['cloud'],
  alerts: ['notifications'],
};

/**
 * S1: four groups of rows. Each row: { id, title, subtitle, status: [lines],
 * problem, label } — `status` is what it says when all is well, `problem`
 * replaces it with only the red 「!」, `label` is what TalkBack reads.
 * `storage` (the 「位置存不進手機」 warning above the groups) is passed through.
 *
 * input: { now, receiverState, receiverWait, point, phone, permissions:
 * { notificationsDenied, nearbyDenied }, recording: { enabled, running },
 * account: { signedIn, email }, cloudFailing, signInExpired, storage, alerts }.
 */
export function settingsHome(input) {
  const reasons = settingsReasons(input);
  const { receiverState: state, now } = input;
  const number = receiverNumber(state);
  const phase = receiverPhase(state, reasons, now);
  const battery = batteryText(receiverBattery(state, input.point));
  const receiverStatus = {
    none: [], off: ['已中斷連線'], connecting: ['連線中'], missing: ['連線中'], disconnected: ['斷線了'],
    waiting: ['已連線'], silent: ['已連線'], connected: ['已連線'],
  }[phase];
  if (['waiting', 'silent', 'connected'].includes(phase) && battery) receiverStatus.push(battery);
  const recording = input.recording || {};
  const account = input.account || {};
  const row = (id, title, subtitle, status) => {
    const own = reasons.filter(reason => ROW_REASONS[id]?.includes(reason));
    const problem = own.length > 0;
    const why = own.map(reason => reasonText(reason, input)).filter(Boolean)
      .filter((text, index, all) => all.indexOf(text) === index).join('、');
    return { id, title, subtitle, status: problem ? [] : status, problem,
      label: problem ? `${title}，有問題：${why}` : [title, subtitle, ...status].filter(Boolean).join('，') };
  };
  return {
    storage: input.storage || null,
    groups: [
      { title: '裝置', rows: [
        row('receiver', '接收器', number != null ? `接收器 ${number}` : receiverSetUp(state) ? '接收器' : '還沒設定接收器',
          receiverStatus),
        row('phone', '手機', '位置記錄、權限', [recording.enabled === false ? '未記錄' : recording.running ? '記錄中' : '']
          .filter(Boolean)),
      ] },
      { title: '帳號與資料', rows: [
        row('account', 'Supabase 帳號', account.signedIn ? account.email || '已登入' : '未登入',
          account.signedIn && account.email ? ['已登入'] : []),
        row('diagnostics', '診斷', '即時資料、本機／雲端資料、記錄清單', []),
      ] },
      // v3 has no 地圖 row (map display options were removed): 提醒 alone.
      // 提醒: how alerts arrive (震動／聲音／關), 「部分開」 when some are off.
      { title: '提醒', rows: [row('alerts', '提醒', '震動、聲音、各項開關', alertsHomeStatus(input.alerts))] },
      // 進階 (S7): the receiver's Wi-Fi and 刪除全部狗資料 (c196).
      { title: '其他', rows: [row('advanced', '進階', '接收器 Wi-Fi、刪除資料', [])] },
    ],
    reasons,
  };
}

const coordinate = (latitude, longitude) => (Number.isFinite(latitude) && Number.isFinite(longitude)
  && !(latitude === 0 && longitude === 0) ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : null);

/**
 * The sources (collars) this receiver has heard, located ones first, newest
 * first: a named or
 * located dog by its name (「狗 9」 until named) over 「訊號源 9」 and the time
 * it was last heard; a source that never had a position only as 「訊號源 9」
 * with 「還沒定位」. Signal sources are only listed: the phone cannot stop one.
 * `packets` are useCloudDogs' newest packets (per source the newest one and
 * the newest with a position).
 */
export function receivedSources(packets, number, aliases) {
  const sources = new Map();
  for (const packet of packets || []) {
    if (packet?.source !== 'ble' || (number != null && Number(packet.master_id) !== number)) continue;
    const slaveId = Number(packet.slave_id);
    if (!Number.isInteger(slaveId) || slaveId <= 0) continue;
    const time = Number(packet.track_at ?? packet.received_at);
    const fixed = coordinate(packet.slave_lat, packet.slave_lon) != null;
    const current = sources.get(slaveId) || { slaveId, time: 0, fixed: false };
    sources.set(slaveId, { slaveId, time: Math.max(current.time, Number.isFinite(time) ? time : 0),
      fixed: current.fixed || fixed });
  }
  // Located ones first (newest first), then the ones never located (S2 mockup).
  return [...sources.values()].sort((left, right) => Number(right.fixed) - Number(left.fixed)
    || right.time - left.time || left.slaveId - right.slaveId)
    .map(source => {
      const alias = aliases?.[source.slaveId]?.trim();
      return source.fixed
        ? { slaveId: source.slaveId, name: alias || `狗 ${source.slaveId}`, detail: `訊號源 ${source.slaveId}`,
          right: source.time ? formatClock(source.time) : '', fixed: true }
        : { slaveId: source.slaveId, name: `訊號源 ${source.slaveId}`, detail: null, right: '還沒定位', fixed: false };
    });
}

/**
 * S2. { setUp, number, title, subtitle, subtitleProblem, battery,
 * batteryProblem, lastHeard, position, connectAction: 'disconnect' |
 * 'reconnect', sources }.
 */
export function receiverPage(input) {
  const reasons = settingsReasons(input);
  const { receiverState: state, now } = input;
  const number = receiverNumber(state);
  const phase = receiverPhase(state, reasons, now);
  const point = input.point;
  const own = point && point.id != null && !isOtherReceiver(point, state);
  const name = state?.deviceName || (number != null ? `DogGPS-Master${number}` : '接收器');
  const silentFor = Math.floor((now - Number(state?.lastReceivedAt)) / MINUTE);
  const status = {
    off: '已中斷連線', connecting: '連線中', missing: number != null ? `找不到接收器 ${number}` : '找不到接收器',
    disconnected: Number(state?.disconnectedAt) > 0 ? `${formatClock(Number(state.disconnectedAt))} 斷線・正在自動重連` : '斷線了',
    waiting: '已連線・還沒收到訊號源', silent: `已連線・${silentFor} 分鐘沒有新資料`, connected: '已連線',
  }[phase];
  const battery = ['off', 'none'].includes(phase) ? null : batteryText(receiverBattery(state, point));
  const last = Number(state?.lastReceivedAt) > 0 ? Number(state.lastReceivedAt) : null;
  return {
    setUp: phase !== 'none',
    phase,
    number,
    title: number != null ? `接收器 ${number}` : '接收器',
    subtitle: status ? `${name}・${status}` : name,
    subtitleProblem: phase === 'missing' || phase === 'disconnected',
    battery,
    batteryProblem: reasons.includes('receiver-battery'),
    lastHeard: last ? `最後收訊 ${formatClock(last)}` : null,
    position: (own && coordinate(point.masterLat, point.masterLon)) || '還沒定位',
    connectAction: phase === 'off' ? 'reconnect' : 'disconnect',
    sources: phase === 'none' ? [] : receivedSources(input.packets, number, input.aliases),
  };
}

// 1842 → 「1,842」 (Hermes may lack locale data for toLocaleString).
const formatCount = value => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Android's own word for what is missing, in the order the design lists. */
export function missingPermissions(phone, permissions = {}) {
  const parts = [];
  const missing = [];
  const location = phone?.permission;
  if (location === 'approximate') parts.push('精確位置只給了大概');
  else if (location === 'denied' || location === 'blocked') missing.push('精確位置');
  if (permissions.nearbyDenied) missing.push('附近的裝置');
  if (permissions.notificationsDenied) missing.push('通知');
  if (missing.length) parts.push(`${missing.join('、')}未允許`);
  return parts.join('、');
}

/**
 * S4. { recording: { on, detail }, permission: { problem, detail, status,
 * action }, services: { problem, detail, status, action }, battery: { status,
 * action } }. Battery optimization is a recommendation: never a 「!」.
 */
export function phonePage(input) {
  const { phone = {}, permissions = {}, recording = {}, todayCount = null } = input;
  const missing = missingPermissions(phone, permissions);
  const servicesOff = phone.permission !== 'checking' && phone.permission !== 'unsupported' && phone.services === false;
  return {
    recording: {
      on: recording.enabled !== false,
      busy: !!recording.busy,
      // Turning it on failed (permission refused…): why, in place of the count.
      detail: recording.error || (Number.isFinite(todayCount) ? `今天 ${formatCount(todayCount)} 筆` : null),
      problem: !!recording.error,
    },
    permission: missing
      ? { problem: true, detail: missing, status: null, action: '開系統設定 ›' }
      : { problem: false, detail: null, status: '已允許', action: null },
    services: servicesOff
      ? { problem: true, detail: '定位服務關著', status: null, action: '打開 ›' }
      : { problem: false, detail: null, status: '已開啟', action: null },
    battery: permissions.batteryIgnored === true
      ? { status: '已允許', action: null }
      : { status: null, action: '開系統設定 ›' },
  };
}

