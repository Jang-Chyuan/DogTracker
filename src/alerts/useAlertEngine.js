import { useCallback, useEffect, useRef, useState } from 'react';
import { pauseAlertState, persistedAlertState, restoreAlertState, resumeAlertState, stepAlerts } from './AlertEngine';
import { carryOutAlertEffects } from './AlertEffects';
import { alertLine } from './AlertContent';
import { bySeverity } from './AlertEvents';

export const ALERT_TICK_MS = 5000;
// Debug preview only: how many deliveries it lists.
const LOG_LENGTH = 12;

/**
 * Runs the alerts while the app is in front: every ALERT_TICK_MS (and when
 * the inputs change) one AlertEngine step over the latest snapshot, its
 * effects carried out (AlertEffects), and the saved state written when it
 * changed. Off screen the receiver's service checks this phone's dogs, the
 * receiver and the storage natively (android .../alerts/BackgroundAlerts):
 * App keeps the state natively and hands it back and forth
 * (AlertNotifications, useNativeAlertState).
 *
 * - `source` names where the inputs come from ('live' or a fixture's name):
 *   a new source starts from its own state (`initial`), so a fixture never
 *   mixes with, or writes over, the real alert state.
 * - `readInput()` returns the snapshot ({ dogs, receiver, receiverBattery,
 *   storageError, cloud, pauses }) once everything has been read, else null:
 *   a half-read start must not clear problems and alert them again.
 * - `clock()` is the time (a fixture's fake clock in the debug preview).
 * - `save(alertState)` keeps persistedAlertState (null: kept in memory only).
 *
 * Returns { badgeCount, pause, problems, content, log, tick, pauseNow, resume }:
 * `problems` are the current ones, most severe first ({ key, kind, line,
 * enabled }); `log` (newest first) is what alerted, for the debug preview.
 */
export function useAlertEngine({
  running, source, initial = null, clock, readInput, preferences, notificationsAllowed = true,
  screen = 'map', foreground = true, save = null, setup = null, period = ALERT_TICK_MS,
}) {
  const state = useRef(null);
  const owner = useRef(null);
  const savedKey = useRef(null);
  const log = useRef([]);
  const [output, setOutput] = useState({ key: '', badgeCount: 0, pause: null, problems: [], content: null,
    notification: 'cancel', log: [] });
  const latest = useRef({});
  latest.current = { clock, readInput, preferences, notificationsAllowed, screen, foreground, save, setup };

  const publish = useCallback(result => {
    const scheduler = state.current.scheduler || {};
    const active = Object.values(state.current.events?.active || {})
      .filter(event => event.present !== false && event.kind).sort(bySeverity);
    const next = {
      badgeCount: result?.effects.badgeCount ?? active.length,
      pause: scheduler.pause && scheduler.pause.until > latest.current.clock() ? scheduler.pause : null,
      problems: active.map(event => ({ key: event.key, kind: event.kind, line: alertLine(event) })),
      content: result?.effects.content ?? null,
      // The notification command (notify / update / cancel).
      notification: result?.effects.notification ?? 'cancel',
      log: log.current,
    };
    const key = JSON.stringify(next);
    setOutput(current => (current.key === key ? current : { ...next, key }));
  }, []);

  // Written when it changed; marked saved only once the write succeeded, so
  // a refused write is tried again on the next tick.
  const writing = useRef(null);
  const persist = useCallback(() => {
    const value = persistedAlertState(state.current);
    const key = JSON.stringify(value);
    const write = latest.current.save;
    if (key === savedKey.current || key === writing.current || !write) return;
    writing.current = key;
    const from = owner.current;
    Promise.resolve()
      .then(() => write(value))
      .then(ok => ok !== false, () => false)
      .then(ok => {
        if (writing.current === key) writing.current = null;
        if (ok && owner.current === from) savedKey.current = key;
      });
  }, []);

  const tick = useCallback(() => {
    const { readInput: read, clock: now, setup: prepare, ...rest } = latest.current;
    const input = read?.();
    if (!input) return;
    const at = now();
    let result = stepAlerts(state.current, { ...input, ...rest, now: at });
    state.current = result.state;
    // A fixture can start paused (alerts-paused): applied once, after the
    // first step has found its problems.
    if (prepare && !owner.current.prepared) {
      owner.current.prepared = true;
      const prepared = prepare(state.current, at);
      if (prepared) {
        state.current = prepared;
        result = stepAlerts(state.current, { ...input, ...rest, now: at });
        state.current = result.state;
      }
    }
    carryOutAlertEffects(result.effects, at);
    if (result.effects.delivered.length) {
      const delivered = result.effects.delivered.map(key => state.current.events.active[key]).filter(Boolean);
      log.current = [{ at, critical: result.effects.critical, vibration: result.effects.vibration,
        sound: result.effects.sound, notification: result.effects.notification,
        card: result.effects.card ? alertLine(result.effects.card.event) : null,
        lines: delivered.map(alertLine) }, ...log.current].slice(0, LOG_LENGTH);
    }
    persist();
    publish(result);
  }, [persist, publish]);

  // A new source: its own state, nothing carried over.
  if (owner.current?.source !== source) {
    owner.current = { source, prepared: false };
    state.current = restoreAlertState(initial);
    savedKey.current = JSON.stringify(persistedAlertState(state.current));
    writing.current = null;
    log.current = [];
  }

  // What was restored (a pause in force) shows at once, before the first
  // snapshot is read.
  useEffect(() => {
    publish(null);
  }, [source, publish]);
  useEffect(() => {
    if (!running) return undefined;
    tick();
    const timer = setInterval(tick, period);
    return () => clearInterval(timer);
  }, [running, period, tick, source]);
  // A switch, the screen or the foreground changing is judged at once.
  const preferencesKey = JSON.stringify(preferences || {});
  useEffect(() => {
    if (running) tick();
  }, [running, tick, preferencesKey, notificationsAllowed, screen, foreground]);

  const pauseNow = useCallback(until => {
    const at = latest.current.clock();
    state.current = pauseAlertState(state.current, at, until);
    persist();
    tick();
  }, [persist, tick]);
  const resume = useCallback(() => {
    state.current = resumeAlertState(state.current, latest.current.clock());
    persist();
    tick();
  }, [persist, tick]);
  return { ...output, tick, pauseNow, resume };
}
