// Pure projections of 058a events. Coordinates belong to the event time, never
// to the dog's current position. No location means a timeline row only.
import { alertTarget, notificationContent } from './AlertContent';
import { SEVERITY } from './AlertEvents';
import { formatClock } from '../map/MapFormat';

export const compareAlerts = (a, b) => (SEVERITY[b.kind] || 0) - (SEVERITY[a.kind] || 0)
  || String(a.key).localeCompare(String(b.key));
export const presentAlerts = active => Object.values(active || {}).filter(event => event.present !== false);
export function alertText(event) {
  return notificationContent({ active: [event] })?.bodyLines[0] ?? null;
}

/** Range inclusive; dogIds omitted includes device events, [] means no dogs.
 * Clear events are episode metadata, not new alerts. Escalations are retained.
 * position must be captured by the caller on each event (no nearest-point guess).
 */
export function alertsHistory(events = [], { start = -Infinity, end = Infinity, dogIds } = {}) {
  const seen = new Set();
  const timeline = events.filter(event => event.type !== 'clear' && SEVERITY[event.kind]
    && Number.isFinite(event.at) && event.at >= start && event.at <= end
    && (dogIds === undefined || (event.kind.startsWith('dog-') && dogIds.includes(event.subject))))
    .slice().sort((a, b) => a.at - b.at || compareAlerts(a, b)).flatMap(event => {
      const id = JSON.stringify([event.key, event.startedAt, event.type, event.at, event.level]);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, kind: 'alert', alertKind: event.kind, dogId: event.kind.startsWith('dog-') ? event.subject : null,
        at: event.at, time: formatClock(event.at), text: alertText(event), icon: 'warning',
        target: alertTarget(event), coordinate: event.coordinate ? { ...event.coordinate } : null }];
    });
  const markers = timeline.filter(row => Number.isFinite(row.coordinate?.latitude)
    && Number.isFinite(row.coordinate?.longitude)).map(row => ({ ...row, coordinate: { ...row.coordinate } }));
  return { timeline, markers };
}

/** Feed scheduleAlerts.effects.cards, not active problems: delivery policy stays
 * in the scheduler. Badge counts current problems, including receiver battery.
 */
export function n3Presentation({ active = [], cards = [], deliveredAt, now, foreground = true, screen = 'history' } = {}) {
  const current = presentAlerts(active).sort(compareAlerts);
  const visible = foreground && screen !== 'map';
  const badgeCount = visible ? current.length : 0;
  const elapsed = now - deliveredAt;
  return { badgeCount, badge: badgeCount ? `⚠ ${badgeCount}` : null,
    cards: visible && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 5000
      ? cards.map(card => card.event).filter(event => event.kind !== 'receiver-battery'
        && current.some(item => item.key === event.key && item.startedAt === event.startedAt))
        .sort(compareAlerts).map(event => ({ key: event.key, text: alertText(event), time: formatClock(event.startedAt),
          target: alertTarget(event), expiresAt: deliveredAt + 5000, dismissible: false, actions: [] })) : [] };
}

/** A tap always enters the live map first; settings/system destinations overlay it. */
export function notificationTap(active) {
  const event = presentAlerts(active).sort(compareAlerts)[0];
  return { screen: 'map', destination: event ? alertTarget(event) : null };
}
