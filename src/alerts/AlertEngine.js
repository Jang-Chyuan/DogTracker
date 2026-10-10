// One alert tick: the problems now (AlertEvents) and what to do about them
// (AlertScheduler), plus the part of that state kept across app restarts
// (design 「重開 App 仍記得暫停」; a problem already alerted is not alerted
// again because the app restarted). Pure.
import { updateAlertEvents } from './AlertEvents';
import { pauseAlerts, resumeAlerts, scheduleAlerts } from './AlertScheduler';

/**
 * @param state { events, scheduler } from the last tick, or restoreAlertState()
 * @param input the snapshot (AlertEvents) and the delivery inputs
 *   (AlertScheduler): { dogs, receiver, receiverBattery, storageError, cloud,
 *   pauses, now, foreground, screen, preferences, notificationsAllowed }
 */
export function stepAlerts(state = {}, input) {
  const events = updateAlertEvents(state.events, input);
  const { state: scheduler, effects } = scheduleAlerts(state.scheduler, { ...input, active: events.active });
  return { state: { events, scheduler }, effects, transitions: events.events };
}

/** Starts a 30-minute pause (or until `until`) of the problems there are now. */
export function pauseAlertState(state = {}, now, until) {
  return { ...state, scheduler: pauseAlerts(state.scheduler, state.events?.active, now, until) };
}

/** 恢復. */
export function resumeAlertState(state = {}, now) {
  return { ...state, scheduler: resumeAlerts(state.scheduler, now) };
}

const finite = value => Number.isFinite(value);
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * What is saved: each problem's start (and level), the battery latches, what
 * was alerted and the pause. It changes only when a problem starts, worsens,
 * clears or alerts, so it is written rarely.
 */
export function persistedAlertState(state = {}) {
  const active = {};
  for (const [key, event] of Object.entries(state.events?.active || {})) {
    active[key] = { key, startedAt: event.startedAt, level: event.level || 1 };
  }
  const { seen = {}, pending = {}, lastAttentionAt = null, pause = null } = state.scheduler || {};
  // `pending` (waiting for the 2-minute gap) is kept too: the app and the
  // background check hand the state to each other (058b).
  return { version: 1, active, batteries: state.events?.batteries || {}, seen, pending, lastAttentionAt, pause };
}

/** The saved value back as a state (anything damaged is dropped). */
export function restoreAlertState(saved) {
  if (!plainObject(saved) || saved.version !== 1) return {};
  const pick = (object, valid) => Object.fromEntries(Object.entries(plainObject(object) ? object : {})
    .filter(([, value]) => plainObject(value) && valid(value)));
  const active = pick(saved.active, value => finite(value.startedAt));
  const batteries = pick(saved.batteries, value => finite(value.startedAt) && finite(value.level));
  const seen = pick(saved.seen, value => typeof value.token === 'string' && finite(value.at));
  const pending = Object.fromEntries(Object.entries(pick(saved.pending, value => typeof value.token === 'string'))
    .map(([key, value]) => [key, { token: value.token, reminder: !!value.reminder, repeat: !!value.repeat }]));
  const pause = plainObject(saved.pause) && finite(saved.pause.until) && plainObject(saved.pause.known)
    ? { since: finite(saved.pause.since) ? saved.pause.since : null, until: saved.pause.until,
      known: pick(Object.fromEntries(Object.entries(saved.pause.known).map(([key, token]) => [key, { token }])),
        value => typeof value.token === 'string') }
    : null;
  if (pause) pause.known = Object.fromEntries(Object.entries(pause.known).map(([key, value]) => [key, value.token]));
  return {
    events: { active, batteries },
    scheduler: { seen, pending, lastAttentionAt: finite(saved.lastAttentionAt) ? saved.lastAttentionAt : null,
      pause },
  };
}

/** The saved value as TrackingPreferences keeps it (null when unusable). */
export function normalizeAlertState(value) {
  if (!plainObject(value) || value.version !== 1) return null;
  return persistedAlertState(restoreAlertState(value));
}
