// What the one merged alert notification says (design v3 N1/N2, 判定表「提醒通知
// 只有一則」「通知本體和「打開地圖」按鈕」, copy c168–c174, c304) and where a tap
// on it (or on an N3 card) leads (cases「通知被點開」). Pure.
import { bySeverity } from './AlertEvents';

export const ALERT_NOTIFICATION_ID = 'dogtracker-alerts';
export const PAUSE_MINUTES = 30;

const isDog = event => event.kind.startsWith('dog-');

/** Where a tap on this problem leads. */
export function alertTarget(event) {
  if (isDog(event)) return { screen: 'map', dogId: event.subject };
  if (event.kind === 'storage') return { screen: event.storage?.full ? 'system-storage' : 'diagnostics' };
  return { screen: 'receiver-settings' };
}

// 「10 分鐘」, 「1 小時」, 「2 天」 (c170 {時長}).
function duration(ms) {
  const minutes = Math.max(10, Math.floor((Number(ms) || 0) / 60000));
  if (minutes < 60) return `${minutes} 分鐘`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小時`;
  return `${Math.floor(minutes / (24 * 60))} 天`;
}

const receiverName = number => (number != null ? `接收器 ${number}` : '接收器');

/** One problem as one line: 「豆豆 不在接收範圍」. */
export function alertLine(event) {
  switch (event.kind) {
    case 'dog-out-of-range':
      return `${event.name} 不在接收範圍`;
    case 'dog-stale':
      // The card's words: a dog held indoors is judged by its packets.
      return `${event.name} ${duration(event.ageMs)}沒有新${event.basis === 'packet' ? '資料' : '位置'}`;
    case 'dog-battery':
      return `${event.name} 電量低 ${event.percentage}%`;
    case 'receiver-battery':
      return `${receiverName(event.number)} 電量低 ${event.percentage}%`;
    case 'storage':
      return event.storage?.full ? '手機空間不足，位置存不進手機' : '位置存不進手機';
    case 'receiver-disconnected': {
      const count = event.outage?.dogCount || 0;
      return `${receiverName(event.outage?.number)} 斷線了${count ? `（${count} 隻狗收不到）` : ''}`;
    }
    default:
      return '';
  }
}

/**
 * The merged notification for the problems it may list (AlertScheduler leaves
 * out what S6 switched off), or null when there is none.
 * - only dogs: 「DogTracker・2 隻狗要注意」 (N1); only the receiver or the phone:
 *   「DogTracker・接收器與手機要注意」 (N2); both: 「DogTracker・3 件事要注意」.
 * - one line per problem, most severe first. While the receiver is
 *   disconnected (and listed), its own dogs going quiet are its 「（3 隻狗收
 *   不到）」, not a line each.
 * - a tap on it opens the most severe problem; 「打開地圖」 only opens the map.
 */
export function notificationContent(problems) {
  const list = (problems || []).filter(event => event.present !== false).slice().sort(bySeverity);
  if (!list.length) return null;
  const outage = list.some(event => event.kind === 'receiver-disconnected');
  const shown = list.filter(event => !(outage && event.kind === 'dog-stale' && event.receiverAffected));
  const dogs = new Set(shown.filter(isDog).map(event => event.subject));
  const devices = shown.filter(event => !isDog(event));
  let title;
  if (!devices.length) title = `DogTracker・${dogs.size} 隻狗要注意`;
  else if (!dogs.size) title = 'DogTracker・接收器與手機要注意';
  else title = `DogTracker・${shown.length} 件事要注意`;
  const lines = shown.map(alertLine);
  return {
    id: ALERT_NOTIFICATION_ID,
    channelId: 'alerts',
    title,
    lines,
    body: lines.join('\n'),
    target: alertTarget(shown[0]),
    actions: [
      { id: 'open-map', label: '打開地圖', target: { screen: 'map', frameAll: true } },
      { id: 'pause', label: `暫停提醒 ${PAUSE_MINUTES} 分` },
    ],
  };
}
