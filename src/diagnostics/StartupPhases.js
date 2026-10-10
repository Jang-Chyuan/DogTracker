/* global globalThis, performance */
// Deliberate opt-in for an instrumented APK/test harness only. Normal release
// never enables this flag. No payloads, identifiers or error messages accepted.
const phases = new Set(['preferences', 'real-initialize', 'initial-latest',
  'initial-position-context', 'initial-snapshot-publish', 'receiver-native',
  'receiver-publish', 'phone-native', 'history-real-wait', 'history-cloud-initialize', 'history-cloud-wait',
  'phone-day-read', 'phone-day-publish', 'phone-model', 'phone-model-commit',
  'map-data-ready', 'map-mounted', 'map-loaded']);
const seen = new Map();
const noop = () => {};
function enabled() {
  return globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ === true
    && typeof globalThis.performance?.now === 'function';
}
function emit(phase, sequence, event, at, durationMs) {
  // Only fixed, non-sensitive fields; never serialize caller input.
  console.info('DOGTRACKER_STARTUP_PHASE', JSON.stringify({ phase, sequence, event, atMs: at, durationMs }));
}
export function beginStartupPhase(phase) {
  if (!enabled() || !phases.has(phase) || (seen.get(phase) ?? 0) >= 2) return noop;
  const sequence = (seen.get(phase) ?? 0) + 1;
  seen.set(phase, sequence);
  const start = performance.now();
  emit(phase, sequence, 'begin', start, 0);
  let finished = false;
  return outcome => {
    if (finished) return;
    finished = true;
    const end = performance.now();
    emit(phase, sequence, outcome === 'failed' ? 'failed' : 'end', end, Math.max(0, end - start));
  };
}
export function markStartupPhase(phase) {
  beginStartupPhase(phase)();
}
export function startupPhase(phase, work) {
  const finish = beginStartupPhase(phase);
  // Disabled path returns exactly the original promise/value, with no handlers.
  if (finish === noop) return work();
  try {
    const result = work();
    if (result?.then) return result.then(value => { finish(); return value; }, error => {
      finish('failed'); throw error;
    });
    finish();
    return result;
  } catch (error) {
    finish('failed');
    throw error;
  }
}
