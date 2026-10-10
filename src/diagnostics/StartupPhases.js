/* global globalThis, performance */
import { isStartupPhase, logStartupPhase } from '../logger';
// Deliberate opt-in for an instrumented APK/test harness only. Normal release
// never enables this flag. No payloads, identifiers or error messages accepted.
const seen = new Map();
const noop = () => {};
function enabled() {
  return globalThis.__DOGTRACKER_STARTUP_DIAGNOSTICS__ === true
    && typeof globalThis.performance?.now === 'function';
}
export function beginStartupPhase(phase) {
  if (!enabled() || !isStartupPhase(phase) || (seen.get(phase) ?? 0) >= 2) return noop;
  const sequence = (seen.get(phase) ?? 0) + 1;
  seen.set(phase, sequence);
  const start = performance.now();
  logStartupPhase(phase, sequence, 'begin', start, 0);
  let finished = false;
  return outcome => {
    if (finished) return;
    finished = true;
    const end = performance.now();
    logStartupPhase(phase, sequence, outcome === 'failed' ? 'failed' : 'end', end, Math.max(0, end - start));
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
