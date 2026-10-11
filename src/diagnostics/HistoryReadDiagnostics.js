import { HISTORY_READ_FLAGS, historyReadDiagnostic } from '../logger';

let nextSequence = 0;
// Only the first attempts and changed gate states of a selection are observed.
// No timer, subscription, identity or cache is owned by this observer.
export function createHistoryReadDiagnostics(clock = Date.now) {
  const sequence = ++nextSequence, began = clock();
  const counts = new Map();
  let events = 0, lastState = null;
  return {
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
