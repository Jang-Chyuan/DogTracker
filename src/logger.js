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

const CLOUD_PHASES = new Set(['initialize', 'begin', 'masters', 'download', 'repair', 'reconcile', 'publish']);
const CLOUD_FAILURES = new Set(['timeout', 'auth', 'network', 'storage', 'unknown']);

// The sole release logging entry point accepts a fixed cloud-sync schema.
// Rebuild the payload rather than passing caller objects to the console;
// generic logs, messages, account IDs, URLs and error objects remain private.
export function cloudSyncDiagnostic(event, fields) {
  // Logging is observational; a refused sink must never fail a download.
  try {
    const attempt = fields?.attempt;
    if (!Number.isSafeInteger(attempt) || attempt < 1) return;
    if (event === 'failure') {
      const phase = fields?.phase;
      const failureKind = fields?.failureKind;
      if (!CLOUD_PHASES.has(phase) || !CLOUD_FAILURES.has(failureKind)) return;
      const status = fields?.status;
      console.info('[CloudSync] failure', { attempt, phase, failureKind,
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null });
    } else if (event === 'recovered') {
      const elapsedMs = fields?.elapsedMs;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
      console.info('[CloudSync] recovered', { attempt, elapsedMs });
    } else if (event === 'latest-published' || event === 'archive-published') {
      const elapsedMs = fields?.elapsedMs;
      const revision = fields?.revision;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isSafeInteger(revision) || revision < 1) return;
      if (event === 'latest-published') console.info('[CloudSync] latest-published', { attempt, elapsedMs, revision });
      else console.info('[CloudSync] archive-published', { attempt, elapsedMs, revision });
    }
  } catch {
    // Do not retry or expose the sink's error/message in another log.
  }
}
