/* global globalThis */
// Sensitive details are available only in development builds.
const emit = (level, args) => { if (typeof __DEV__ !== 'undefined' && __DEV__) console[level](...args); };
export const logger = Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => emit(level, args)]));

const PRIVATE_ATTEMPT_FIELDS = Object.freeze(['schema', 'attempt', 'terminal', 'clockValid', 'elapsedMs',
  'phase', 'failureKind', 'foreground', 'fetchStarted', 'fetchDone', 'fetchPending', 'fetchMs',
  'fetchStatus', 'retryMax', 'retry503', 'retry520', 'allFetchStartedDelta', 'allFetchDoneDelta',
  'allFetchPendingAtStart', 'allFetchPending', 'allFetchRetryMax', 'allFetchStatus', 'capped', 'storageAggregate',
  ...['masters', 'keys', 'packet', 'fix'].flatMap(stage => ['Started', 'Done', 'Pending'].map(suffix => `${stage}${suffix}`)),
  ...['get', 'set', 'remove'].flatMap(kind => [
    ...['Started', 'Done', 'Pending', 'Ms'].map(suffix => `storage${kind}${suffix}`),
    `allStorage${kind}PendingAtStart`, `allStorage${kind}Pending`,
  ])]);
const PRIVATE_ATTEMPT_ENUMS = {
  schema: [1], terminal: [0, 1, 2, 3], clockValid: [0, 1], phase: [-1, 0, 1, 2, 3, 4, 5, 6],
  failureKind: [-1, 0, 1, 2, 3, 4], foreground: [-1, 0, 1], capped: [0, 1], storageAggregate: [1],
};

// The private observer stays disabled in normal builds. Accept only its exact
// numeric schema; read each field once and rebuild to exclude caller payloads,
// toJSON methods, messages, auth data and URLs. Observer errors remain silent.
export function privateCloudAttemptDiagnostic(fields) {
  try {
    if (globalThis.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ !== true || !fields || typeof fields !== 'object') return;
    const keys = Reflect.ownKeys(fields);
    if (keys.length !== PRIVATE_ATTEMPT_FIELDS.length || !keys.every(key => PRIVATE_ATTEMPT_FIELDS.includes(key))) return;
    const result = Object.fromEntries(PRIVATE_ATTEMPT_FIELDS.map(key => [key, fields[key]]));
    for (const [key, value] of Object.entries(result)) {
      if (!Number.isSafeInteger(value)) return;
      if (Object.prototype.hasOwnProperty.call(PRIVATE_ATTEMPT_ENUMS, key)) {
        if (!PRIVATE_ATTEMPT_ENUMS[key].includes(value)) return;
      } else if (value < (key === 'attempt' ? 1 : 0) || value > 2147483647) return;
    }
    for (const key of ['fetchStatus', 'allFetchStatus'])
      if (result[key] !== 0 && (result[key] < 100 || result[key] > 599)) return;
    console.info('DOGTRACKER_PRIVATE_CLOUD_ATTEMPT', JSON.stringify(result));
  } catch {
    // A refused diagnostic sink never changes auth, queries or publication.
  }
}


// An explicitly instrumented APK may emit only this bounded, fixed schema.
// This is separate from the development logger: arbitrary payloads stay silent.
const startupPhases = new Set(['preferences', 'real-initialize', 'initial-latest',
  'initial-position-context', 'initial-snapshot-publish', 'receiver-native',
  'receiver-publish', 'phone-native', 'history-real-wait', 'history-cloud-initialize', 'history-cloud-wait',
  'phone-day-read', 'phone-day-publish', 'phone-model', 'phone-model-commit',
  'map-data-ready', 'map-mounted', 'map-loaded', 'phone-settled', 'cloud-latest-settled', 'map-framed',
  'splash-handover']);
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
const LATEST_TIMINGS = ['slotWaitMs', 'initializeMs', 'archiveProofMs',
  'latestCacheReadMs', 'mastersMs', 'latestHTTPMs', 'snapshotCommitMs'];

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
    } else if (event === 'latest-published' || event === 'archive-published' || event === 'latest-applied') {
      const elapsedMs = fields?.elapsedMs;
      const revision = fields?.revision;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isSafeInteger(revision) || revision < 1) return;
      if (event === 'latest-published') {
        // Optional extension: incomplete/invalid timings preserve the legacy
        // success event. Copy only these fixed nonnegative elapsed numbers.
        const timings = LATEST_TIMINGS.every(key => Number.isFinite(fields[key]) && fields[key] >= 0)
          ? Object.fromEntries(LATEST_TIMINGS.map(key => [key, fields[key]])) : {};
        console.info('[CloudSync] latest-published', { attempt, elapsedMs, revision, ...timings });
      } else if (event === 'latest-applied') console.info('[CloudSync] latest-applied', { attempt, elapsedMs, revision });
      else console.info('[CloudSync] archive-published', { attempt, elapsedMs, revision });
    } else if (event === 'context-failed' || event === 'context-published') {
      // Stop-context stage: elapsed time of that stage plus aggregate counts.
      // No dog/Master identity, cutoff, URL or error text is accepted.
      const elapsedMs = fields?.elapsedMs;
      const dogs = fields?.dogs;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isSafeInteger(dogs) || dogs < 0) return;
      if (event === 'context-published') {
        console.info('[CloudSync] context-published', { attempt, elapsedMs, dogs });
        return;
      }
      const failureKind = fields?.failureKind;
      const completedDogs = fields?.completedDogs;
      const requests = fields?.requests;
      if (!CLOUD_FAILURES.has(failureKind) || !Number.isSafeInteger(completedDogs) || completedDogs < 0
        || completedDogs > dogs || !Number.isSafeInteger(requests) || requests < 0) return;
      console.info('[CloudSync] context-failed', { attempt, elapsedMs, failureKind, dogs, completedDogs, requests });
    }
  } catch {
    // Do not retry or expose the sink's error/message in another log.
  }
}

const HISTORY_READ_PHASES = new Set(['row', 'proof', 'model', 'state']);
const HISTORY_READ_EVENTS = new Set(['begin', 'end', 'rejected', 'blocked', 'failed', 'state']);
export const HISTORY_READ_FLAGS = Object.freeze(['publicationPending', 'fenceOpen', 'materialKnown',
  'ownerMatches', 'generationMatches', 'rowsLoaded', 'completenessLoaded', 'coverageReady', 'modelReady']);

// History read/model diagnostics are private, like the cloud attempt
// observer: off in every normal (release) build unless explicitly enabled.
export const historyDiagnosticsEnabled = () => globalThis.__DOGTRACKER_PRIVATE_HISTORY_DIAGNOSTICS__ === true;

// A bounded selection's diagnostic contains no identity, route or wall-clock
// timestamp. Callers cannot pass through messages, errors or query payloads.
export function historyReadDiagnostic(fields) {
  try {
    if (!historyDiagnosticsEnabled()) return;
    if (!Number.isSafeInteger(fields?.sequence) || fields.sequence < 1
      || !HISTORY_READ_PHASES.has(fields.phase) || !HISTORY_READ_EVENTS.has(fields.event)
      || !Number.isFinite(fields.elapsedMs) || fields.elapsedMs < 0
      || !HISTORY_READ_FLAGS.every(key => typeof fields[key] === 'boolean')) return;
    console.info('[HistoryRead]', { sequence: fields.sequence, phase: fields.phase, event: fields.event,
      elapsedMs: fields.elapsedMs, ...Object.fromEntries(HISTORY_READ_FLAGS.map(key => [key, fields[key]])) });
  } catch {
    // Diagnostics never change a query or publication outcome.
  }
}

export const HISTORY_MODEL_STAGES = Object.freeze(['stream', 'replay', 'filter', 'context-movement',
  'range-movement', 'stops', 'indoor', 'cursors', 'map-presentation', 'model-to-effect']);

// Model sub-stages share the selection's opaque numeric sequence. Counts are
// aggregate input sizes, never identities, packet values or clock timestamps.
export function historyModelDiagnostic(fields) {
  try {
    if (!historyDiagnosticsEnabled()) return;
    if (!Number.isSafeInteger(fields?.sequence) || fields.sequence < 1
      || !HISTORY_MODEL_STAGES.includes(fields.stage)
      || !Number.isFinite(fields.elapsedMs) || fields.elapsedMs < 0
      || !Number.isSafeInteger(fields.inputCount) || fields.inputCount < 0) return;
    console.info('[HistoryModel]', { sequence: fields.sequence, stage: fields.stage,
      elapsedMs: fields.elapsedMs, inputCount: fields.inputCount });
  } catch {
    // A refused diagnostic sink cannot change a model or its publication.
  }
}
