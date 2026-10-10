/* global globalThis */
// Sensitive details are available only in development builds.
const emit = (level, args) => { if (typeof __DEV__ !== 'undefined' && __DEV__) console[level](...args); };
export const logger = Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => emit(level, args)]));


// An explicitly instrumented APK may emit only this bounded, fixed schema.
// This is separate from the development logger: arbitrary payloads stay silent.
const startupPhases = new Set(['preferences', 'real-initialize', 'initial-latest',
  'initial-position-context', 'initial-snapshot-publish', 'receiver-native',
  'receiver-publish', 'phone-native', 'history-real-wait', 'history-cloud-initialize', 'history-cloud-wait',
  'phone-day-read', 'phone-day-publish', 'phone-model', 'phone-model-commit',
  'map-data-ready', 'map-mounted', 'map-loaded']);
export const isStartupPhase = phase => typeof phase === 'string' && startupPhases.has(phase);
export function logStartupPhase(phase, sequence, event, atMs, durationMs) {
  if (globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ !== true || arguments.length !== 5
    || !isStartupPhase(phase) || ![1, 2].includes(sequence)
    || !['begin', 'end', 'failed'].includes(event)
    || !Number.isFinite(atMs) || atMs < 0 || !Number.isFinite(durationMs) || durationMs < 0) return;
  console.info('DOGTRACKER_STARTUP_PHASE', JSON.stringify({ phase, sequence, event, atMs, durationMs }));
}
