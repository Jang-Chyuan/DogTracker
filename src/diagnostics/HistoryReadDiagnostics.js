import { HISTORY_READ_FLAGS, HISTORY_MODEL_STAGES, historyReadDiagnostic, historyModelDiagnostic } from '../logger';

let nextSequence = 0;
// Only the first attempts and changed gate states of a selection are observed.
// No timer, subscription, identity or cache is owned by this observer.
export function createHistoryReadDiagnostics(clock = Date.now) {
  const sequence = ++nextSequence, began = clock();
  const counts = new Map();
  const modelCounts = new Map();
  let events = 0, lastState = null;
  const modelEnd = (stage, started, inputCount) => {
    try {
      if (!HISTORY_MODEL_STAGES.includes(stage) || (modelCounts.get(stage) ?? 0) >= 2) return;
      modelCounts.set(stage, (modelCounts.get(stage) ?? 0) + 1);
      historyModelDiagnostic({ sequence, stage, inputCount, elapsedMs: Math.max(0, clock() - started) });
    } catch {
      // Clock/sink failure cannot alter the product operation's result.
    }
  };
  return {
    measure(stage, inputCount, operation) {
      let started;
      try { started = clock(); } catch { /* Execute the operation even without a diagnostic clock. */ }
      // Product exceptions propagate unchanged; no retry or swallowed failure.
      try { return operation(); } finally { if (started !== undefined) modelEnd(stage, started, inputCount); }
    },
    modelEnd,
    emit(phase, event, started = began, flags = {}) {
      try {
        const safe = Object.fromEntries(HISTORY_READ_FLAGS.map(key => [key, flags[key] === true]));
        const key = `${phase}:${event}`;
        if (events >= 40 || (phase !== 'state' && (counts.get(key) ?? 0) >= 2)) return;
        if (phase === 'state') {
          const signature = HISTORY_READ_FLAGS.map(name => safe[name] ? '1' : '0').join('');
          if (signature === lastState || (counts.get(key) ?? 0) >= 16) return;
          lastState = signature;
        }
        counts.set(key, (counts.get(key) ?? 0) + 1); events++;
        historyReadDiagnostic({ sequence, phase, event, elapsedMs: Math.max(0, clock() - started), ...safe });
      } catch {
        // Refused clock/sink cannot affect the observed product operation.
      }
    },
  };
}

export function historyPublicationFlags(publication, owner, before = null, fenceOpen = !!owner && publication?.owner === owner && publication?.publishedPending === false) {
  return { publicationPending: publication?.publishedPending === true, fenceOpen,
    materialKnown: Number.isSafeInteger(publication?.dataRevision) && publication.dataRevision >= 0,
    ownerMatches: !!owner && publication?.owner === owner,
    generationMatches: !!publication && (!before || (publication?.scope === before.scope && publication?.generation === before.generation)) };
}
