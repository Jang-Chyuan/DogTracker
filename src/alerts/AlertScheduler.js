// When a problem gets the user's attention, and how (design v3 「提醒的規則」
// 「每一項都可以關」「S6 的開關管什麼」「暫停」「危急的不等間隔」, edges「提醒」).
// Pure: takes AlertEvents' current problems each tick, returns the next state
// and the effects to carry out (commands, never native calls).
//
// - Attention (a vibration, the sound, an N3 card, a notification that
//   alerts) happens at four moments only: a problem's first time, it getting
//   worse (a dog's battery 20% → 10%), the one reminder (沒有新位置: 30 minutes
//   after the first alert, once), and the problem coming back after it
//   cleared. Content updates in between are silent.
// - At most one attention every 2 minutes; problems in between wait and come
//   together. 不在接收範圍 and 接收器斷線 come at once, with the strong pattern.
// - S6 switches a kind off: never listed in the notification, no vibration, no
//   sound, no N3 card, no reminder; switched on again, a problem still there is
//   not sent late. What the app shows is not affected (badgeCount counts all).
// - 暫停提醒 30 分 silences the problems known at that moment; a new dog, a new
//   problem or a worse one still alerts. When it ends (or 恢復), the paused
//   ones still there come once together.
// - In the foreground there is no system notification, but it still vibrates;
//   the N3 card only off the live map. Cloud dogs alert only in the foreground.
import { alertDelivery, alertEnabled } from './AlertPreferences';
import { bySeverity } from './AlertEvents';
import { notificationContent, PAUSE_MINUTES } from './AlertContent';
import { formatClock } from '../map/MapFormat';

export const REMINDER_MS = 30 * 60000;
export const ATTENTION_GAP_MS = 2 * 60000;
export const PAUSE_MS = PAUSE_MINUTES * 60000;
export const N3_CARD_MS = 5000;
// The two problems that do not wait for the 2-minute gap.
export const CRITICAL_KINDS = Object.freeze(['dog-out-of-range', 'receiver-disconnected']);
// Long-short-long, about 1.5 s, once (critical); one short buzz otherwise.
export const VIBRATION_PATTERNS = Object.freeze({
  normal: Object.freeze([0, 250]),
  critical: Object.freeze([0, 500, 150, 200, 150, 500]),
});
// Alerts and the always-on service are two channels (Android 細節).
export const ALERT_CHANNELS = Object.freeze([
  Object.freeze({ id: 'alerts', name: '提醒', importance: 'high' }),
  Object.freeze({ id: 'tracking', name: '常駐', importance: 'low', sound: false, vibrate: false }),
]);

// One episode at one severity level.
export const episodeToken = event => `${event.startedAt}:${event.level || 1}`;

const pauseOn = (pause, now) => !!pause && pause.until > now;

/** Starts a pause of the problems known now (the notification's 「暫停提醒 30 分」). */
export function pauseAlerts(state = {}, active = {}, now, until = now + PAUSE_MS) {
  const known = {};
  for (const event of Object.values(active)) known[event.key] = episodeToken(event);
  const pending = { ...state.pending };
  for (const key of Object.keys(known)) delete pending[key];
  return { ...state, pending, pause: { since: now, until, known } };
}

/** 恢復: the pause ends now (the paused problems still there come once). */
export function resumeAlerts(state = {}, now) {
  return pauseOn(state.pause, now) ? { ...state, pause: { ...state.pause, until: now } } : state;
}

/** S1 「暫停到 11:10」, S6 「已暫停提醒到 11:10」＋「恢復」 (c297–c299), or null. */
export function pausePresentation(pause, now) {
  if (!pauseOn(pause, now)) return null;
  const clock = formatClock(pause.until);
  return { until: pause.until, short: `暫停到 ${clock}`, title: `已暫停提醒到 ${clock}`, action: '恢復' };
}

/**
 * @param previous the state this returned last time ({} at first)
 * @param input.active AlertEvents' `active`
 * @param input.now epoch ms
 * @param input.foreground the app is in front
 * @param input.screen 'map' (the live map) or anything else (history,
 *   settings): where an N3 card may slide down
 * @param input.preferences S6 (AlertPreferences)
 * @param input.notificationsAllowed the system lets this app notify
 * @returns {{ state, effects: { notification: 'notify'|'update'|'cancel',
 *   content, vibration, critical, sound, stopTouchHaptics, card, badgeCount,
 *   delivered } }}
 */
export function scheduleAlerts(previous = {}, {
  active = {}, now, foreground = true, screen = 'map', preferences, notificationsAllowed = true,
} = {}) {
  const seen = { ...previous.seen };
  const pending = { ...previous.pending };
  let pause = previous.pause ?? null;
  const present = Object.values(active).filter(event => event.present !== false).sort(bySeverity);
  const enabled = event => alertEnabled(preferences, event.kind);
  // The receiver's disconnection (when it alerts) speaks for its quiet dogs.
  const outageAlerts = present.some(event => event.kind === 'receiver-disconnected' && enabled(event));
  const covered = event => outageAlerts && event.kind === 'dog-stale' && event.receiverAffected;
  // A cloud dog in the background is judged when the app is back in front.
  const deferred = event => !foreground && event.source === 'cloud';

  // A problem that cleared is forgotten: when it comes back it is new. A
  // battery hidden at 21–30% stays (it is not over).
  for (const key of Object.keys(seen)) if (!active[key]) delete seen[key];
  const presentKeys = new Set(present.map(event => event.key));
  for (const key of Object.keys(pending)) if (!presentKeys.has(key)) delete pending[key];

  const paused = pauseOn(pause, now);
  const ended = !!pause && !paused;
  for (const event of present) {
    if (deferred(event)) continue;
    const token = episodeToken(event);
    const before = seen[event.key];
    if (!enabled(event) || covered(event)) {
      // Switched off (or said by the disconnection): never sent, also not
      // later when switched on again; no reminder either.
      seen[event.key] = { token, at: before?.token === token ? before.at : now, reminded: true };
      delete pending[event.key];
      continue;
    }
    const fresh = !before || before.token !== token;
    const reminder = !fresh && event.kind === 'dog-stale' && !before.reminded && now - before.at >= REMINDER_MS;
    const known = !!pause && pause.known?.[event.key] === token;
    if (paused && known) {
      delete pending[event.key];
      continue;
    }
    // A reminder, and the paused ones coming back at the end, are not new:
    // they wait for the gap and never use the strong pattern.
    if (fresh || reminder || (ended && known)) pending[event.key] = { token, reminder: !fresh && reminder, repeat: !fresh };
  }
  if (ended) pause = null;

  const queued = present.filter(event => pending[event.key]);
  const critical = queued.some(event => CRITICAL_KINDS.includes(event.kind) && !pending[event.key].repeat);
  const deliver = queued.length > 0 && (critical || ended || previous.lastAttentionAt == null
    || now - previous.lastAttentionAt >= ATTENTION_GAP_MS);
  let lastAttentionAt = previous.lastAttentionAt ?? null;
  if (deliver) {
    for (const event of queued) {
      const before = seen[event.key];
      const fresh = !before || before.token !== pending[event.key].token;
      seen[event.key] = {
        token: pending[event.key].token,
        at: fresh ? now : before.at,
        reminded: fresh ? false : before.reminded || pending[event.key].reminder,
      };
      delete pending[event.key];
    }
    lastAttentionAt = now;
  }

  // What the notification may list: switched-on problems (not a cloud dog in
  // the background). While paused with nothing new, there is none.
  const listed = present.filter(event => enabled(event) && !deferred(event));
  const content = notificationContent(listed);
  const silenced = pauseOn(pause, now) && listed.every(event => pause.known?.[event.key] === episodeToken(event));
  const how = alertDelivery(preferences);
  const cardEvent = deliver && foreground && screen !== 'map'
    ? queued.find(event => event.kind !== 'receiver-battery') ?? null : null;
  const effects = {
    notification: foreground || !notificationsAllowed || !content || silenced
      ? 'cancel' : deliver ? 'notify' : 'update',
    content,
    delivered: deliver ? queued.map(event => event.key) : [],
    vibration: deliver && how.vibrate ? [...VIBRATION_PATTERNS[critical ? 'critical' : 'normal']] : null,
    critical: deliver && critical,
    sound: deliver && how.sound,
    // A touch haptic never plays over an alert's pattern.
    stopTouchHaptics: deliver && how.vibrate,
    // N3: one card, the most severe; the rest only count in 「⚠ N」.
    card: cardEvent ? { event: cardEvent, durationMs: N3_CARD_MS } : null,
    // 「⚠ N」: every problem there is, switched on or not (it is state).
    badgeCount: present.length,
  };
  return { state: { seen, pending, lastAttentionAt, pause }, effects };
}
