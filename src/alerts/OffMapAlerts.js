// The alerts off the live map (design v3 N3, 判定表「提醒入口（歷史畫面、設定
// 頁）」「歷史和設定的紅色「⚠ N」」「N3 同時有好幾件事」「提醒卡（A2、A2c、N3
// 共用）」). Pure.
//
// - N3: the one card AlertScheduler hands over (the most severe problem that
//   just alerted; S6 switched it on) slides down for 5 s over the history
//   screen or a settings page, then disappears. History keeps 「⚠ N」;
//   settings pages have no badge (D17, 2026-10-09). No button, no ✕:
//   the whole card opens its problem.
// - 「⚠ N」: the problems there are now, whatever S6 says (it is state, not an
//   alert): each dog counts once, 接收器斷線, 接收器電量低 and 位置存不進手機
//   once each; a battery hidden at 21–30% does not count. A tap opens the
//   most severe one, as the merged notification does.
import { alertLine, alertTarget } from './AlertContent';
import { bySeverity } from './AlertEvents';
import { N3_CARD_MS } from './AlertScheduler';
import { formatClock } from '../map/MapFormat';

export { N3_CARD_MS };

// Where N3 slides down (only history keeps 「⚠ N」; the live map has top cards
// and the dogs' red 「!」).
export const OFF_MAP_SCREENS = Object.freeze(['history', 'settings']);

const isDog = event => event.kind.startsWith('dog-');
const present = active =>
  (Array.isArray(active) ? active : Object.values(active || {}))
    .filter(event => event && event.kind && event.present !== false)
    .slice()
    .sort(bySeverity);

/**
 * 「⚠ N」 for AlertEvents' current problems, or null when there is none:
 * { count, text: '⚠ 2', label (TalkBack), target (the most severe's) }.
 */
export function alertBadge(active) {
  const list = present(active);
  if (!list.length) return null;
  const dogs = new Set(list.filter(isDog).map(event => event.subject));
  const count = dogs.size + list.filter(event => !isDog(event)).length;
  return {
    count,
    text: `⚠ ${count}`,
    label: `${count} 件事要注意，打開${alertLine(list[0])}`,
    target: alertTarget(list[0]),
  };
}

// The same icons as the live map's top cards; a dog's problem has the
// warning triangle (N3 mockup).
const ICONS = { 'receiver-disconnected': 'receiver-off', storage: 'storage' };

/**
 * The N3 card for one delivered problem (AlertScheduler's effects.card):
 * 「豆豆 不在接收範圍」 over the time it started 「10:18」.
 * `id` changes with every delivery, so the same problem alerting again (a
 * reminder, the battery at 10%) slides down again.
 */
export function n3Card(event, deliveredAt) {
  if (!event?.kind) return null;
  return {
    id: `${event.key}|${deliveredAt}`,
    key: event.key,
    kind: 'alert',
    icon: ICONS[event.kind] ?? 'warning',
    title: alertLine(event),
    detail: formatClock(event.startedAt),
    target: alertTarget(event),
    deliveredAt,
    expiresAt: deliveredAt + N3_CARD_MS,
  };
}

/**
 * What shows now: { card, badge }. The card while its 5 s run (and its
 * problem is still there). History shows the badge once it collapses;
 * settings never shows a badge, including with S6 switched off.
 */
export function offMapAlerts({ active, card = null, now, screen }) {
  if (!OFF_MAP_SCREENS.includes(screen)) return { card: null, badge: null };
  const list = present(active);
  const shown = card && now >= card.deliveredAt && now < card.expiresAt
    && list.some(event => event.key === card.key) ? card : null;
  return { card: shown, badge: screen === 'history' && !shown ? alertBadge(list) : null };
}
