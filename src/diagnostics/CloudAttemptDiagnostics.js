/* global globalThis */
import { privateCloudAttemptDiagnostic } from '../logger';
// Private APK opt-in only. Never record request arguments, responses, tokens,
// account/animal IDs, URLs or wall-clock timestamps. Counters are observational.
const STAGES = ['masters', 'keys', 'packet', 'fix'];
const PHASES = ['initialize', 'begin', 'masters', 'download', 'repair', 'reconcile', 'publish'];
const FAILURES = ['timeout', 'auth', 'network', 'storage', 'unknown'];
const integer = value => Number.isFinite(value) ? Math.max(0, Math.min(2147483647, Math.round(value))) : 0;
const statusCode = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : 0;

export function createCloudAttemptDiagnostics({ enabled, clock, sink }) {
  const signals = new WeakMap();
  let current = null, attempts = 0, openedAt = null, timer = null, closed = false;
  const transportTotals = { started: 0, done: 0, retryMax: 0, status: 0, ms: 0 };
  const storageTotals = Object.fromEntries(['get', 'set', 'remove'].map(kind => [kind, [0, 0, 0]]));
  let capped = false;
  const live = value => !!value && current === value && !value.closed;
  const stamp = () => { try { const value = clock(); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const permitted = () => { try { return enabled() === true && !closed; } catch { return false; } };
  function emit(value, terminal, phase = '', failure = '', foreground = null) {
    if (!live(value)) return;
    const at = stamp(); value.closed = true; current = null;
    const result = { schema: 1, attempt: value.attempt, terminal,
      clockValid: at != null && at >= value.at ? 1 : 0,
      elapsedMs: integer(at == null ? 0 : at - value.at), phase: PHASES.indexOf(phase),
      failureKind: FAILURES.indexOf(failure), foreground: typeof foreground === 'boolean' ? (foreground ? 1 : 0) : -1,
      fetchStarted: value.fetchStarted, fetchDone: value.fetchDone,
      fetchPending: value.fetchStarted - value.fetchDone, fetchMs: value.fetchMs,
      fetchStatus: value.fetchStatus, retryMax: value.retryMax, retry503: value.retry503, retry520: value.retry520,
      allFetchStartedDelta: transportTotals.started - value.transportBase.started,
      allFetchDoneDelta: transportTotals.done - value.transportBase.done,
      allFetchPendingAtStart: value.transportBase.started - value.transportBase.done,
      allFetchPending: transportTotals.started - transportTotals.done,
      allFetchRetryMax: transportTotals.retryMax, allFetchStatus: transportTotals.status, capped: capped ? 1 : 0,
      // SecureStorage counts only operations started during this attempt.
      // Other SDK users may overlap: this is an aggregate, not query attribution.
      storageAggregate: 1,
    };
    for (const stage of STAGES) {
      result[`${stage}Started`] = value.logical[stage][0];
      result[`${stage}Done`] = value.logical[stage][1];
      result[`${stage}Pending`] = value.logical[stage][0] - value.logical[stage][1];
    }
    for (const kind of ['get', 'set', 'remove']) {
      const [started, done, ms] = value.storage[kind];
      result[`storage${kind}Started`] = started; result[`storage${kind}Done`] = done;
      result[`storage${kind}Pending`] = started - done; result[`storage${kind}Ms`] = ms;
      result[`allStorage${kind}PendingAtStart`] = value.storageBase[kind][0] - value.storageBase[kind][1];
      result[`allStorage${kind}Pending`] = storageTotals[kind][0] - storageTotals[kind][1];
    }
    try { sink(Object.freeze(result)); } catch { /* A refused observer cannot fail a download. */ }
  }
  function windowOpen() {
    if (!permitted()) return false;
    const at = stamp(); if (at == null) return false;
    if (openedAt != null && at - openedAt >= 240000) {
      if (current) emit(current, 3);
      closed = true; clearTimeout(timer); timer = null; return false;
    }
    if (openedAt == null) {
      openedAt = at;
      timer = setTimeout(() => { if (current) emit(current, 3); closed = true; timer = null; }, 240000);
    }
    return true;
  }
  return {
    begin(attempt) {
      if (!permitted() || current || attempts >= 3 || !Number.isSafeInteger(attempt) || attempt < 1) return null;
      if (!windowOpen()) return null;
      const at = stamp();
      attempts++;
      const value = { attempt, at, closed: false, logical: Object.fromEntries(STAGES.map(stage => [stage, [0, 0]])),
        storage: Object.fromEntries(['get', 'set', 'remove'].map(kind => [kind, [0, 0, 0]])),
        transportBase: { started: transportTotals.started, done: transportTotals.done },
        storageBase: Object.fromEntries(Object.entries(storageTotals).map(([kind, counts]) => [kind, [...counts]])),
        fetchStarted: 0, fetchDone: 0, fetchMs: 0, fetchStatus: 0, retryMax: 0, retry503: 0, retry520: 0 };
      current = value;
      return {
        bind(signal) { if (live(value) && signal && typeof signal === 'object') signals.set(signal, value); },
        finish(terminal, phase, failure, foreground) {
          if ([0, 1, 2].includes(terminal)) emit(value, terminal, phase, failure, foreground);
        },
      };
    },
    inherit(parent, child) {
      const value = parent && signals.get(parent);
      if (live(value) && child && typeof child === 'object') signals.set(child, value);
    },
    observing: permitted,
    logical(signal, stage) {
      const value = signal && signals.get(signal);
      if (!live(value) || !STAGES.includes(stage)) return null;
      if (value.logical[stage][0] >= 4096) { capped = true; return null; }
      value.logical[stage][0]++;
      let done = false;
      return () => { if (!done && live(value)) { done = true; value.logical[stage][1]++; } };
    },
    transport(signal, retry) {
      const value = signal && signals.get(signal);
      if (!windowOpen()) return null;
      if (transportTotals.started >= 4096) { capped = true; return null; }
      const associated = live(value);
      transportTotals.started++;
      if (associated) value.fetchStarted++;
      const at = stamp(); let done = false;
      if (Number.isInteger(retry) && retry >= 0 && retry <= 3) {
        transportTotals.retryMax = Math.max(transportTotals.retryMax, retry);
        if (associated) value.retryMax = Math.max(value.retryMax, retry);
      }
      return status => {
        if (done || closed) return;
        done = true; transportTotals.done++; const end = stamp();
        const duration = integer(at == null || end == null ? 0 : end - at);
        transportTotals.ms += duration; transportTotals.status = statusCode(status);
        if (!live(value)) return;
        value.fetchDone++; value.fetchMs += duration;
        value.fetchStatus = statusCode(status);
        if (status === 503) value.retry503++;
        if (status === 520) value.retry520++;
      };
    },
    storage(kind) {
      const value = current;
      if (!['get', 'set', 'remove'].includes(kind) || !windowOpen()) return null;
      if (storageTotals[kind][0] >= 4096) { capped = true; return null; }
      storageTotals[kind][0]++;
      if (live(value)) value.storage[kind][0]++;
      const at = stamp(); let done = false;
      return () => {
        if (done || closed) return;
        done = true; storageTotals[kind][1]++;
        const end = stamp(), duration = integer(at == null || end == null ? 0 : end - at);
        storageTotals[kind][2] += duration;
        if (live(value)) { value.storage[kind][1]++; value.storage[kind][2] += duration; }
      };
    },
    close() { if (current) current.closed = true; current = null; closed = true; clearTimeout(timer); timer = null; },
  };
}

const observer = createCloudAttemptDiagnostics({
  enabled: () => globalThis.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ === true,
  clock: () => globalThis.performance?.now?.(),
  sink: privateCloudAttemptDiagnostic,
});
export const beginCloudAttemptDiagnostic = attempt => observer.begin(attempt);
export const inheritCloudDiagnosticSignal = (parent, child) => observer.inherit(parent, child);
export const beginCloudLogicalDiagnostic = (signal, stage) => observer.logical(signal, stage);
export const beginCloudStorageDiagnostic = kind => observer.storage(kind);

// Wrap the exact configured transport. With diagnostics disabled/unassociated,
// its original promise, arguments and invocation are returned unchanged.
export function cloudDiagnosticFetch(fetchImpl, instrumentation = observer) {
  return function (...args) {
    const init = args[1];
    let observing = false;
    try { observing = instrumentation.observing(); } catch { /* Observer failure is irrelevant to transport. */ }
    if (!observing) return fetchImpl.apply(this, args);
    let retry = 0;
    try {
      const headers = init?.headers;
      const value = headers?.get ? headers.get('X-Retry-Count') : headers?.['X-Retry-Count'];
      if (value != null && /^[0-3]$/.test(String(value))) retry = Number(value);
    } catch { /* Never observe other headers or alter the request. */ }
    let done;
    try { done = instrumentation.transport(init?.signal, retry); } catch { /* Pass through unchanged. */ }
    if (!done) return fetchImpl.apply(this, args);
    const complete = response => {
      try { done(response?.status); } catch { /* No observer can reject a response. */ }
    };
    let result;
    try { result = fetchImpl.apply(this, args); }
    catch (error) { complete(null); throw error; }
    return Promise.resolve(result).then(response => { complete(response); return response; }, error => { complete(null); throw error; });
  };
}
