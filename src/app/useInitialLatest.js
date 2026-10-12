import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reportInitialLatest, useSplashState } from './hideSplash';

export const INITIAL_LATEST_WAIT_MS = 10000;

// A persisted baseline is not a fresh publication. The proof travels with the
// accepted rows/holds, so a reused numeric revision from a replacement engine
// or another account cannot release the first map.
export function initialLatestAccepted(owner, publication, dogs) {
  const proof = dogs?.cloudPublication;
  return !!owner && publication?.owner === owner && proof?.owner === owner
    && publication.scope != null && Number.isSafeInteger(publication.generation)
    && proof.scope === publication.scope && proof.generation === publication.generation
    && Number.isSafeInteger(proof.revision) && proof.revision > 0
    && dogs.cloudCommit === proof.revision
    && Number.isSafeInteger(publication.mapSuccessRevision)
    && proof.revision <= publication.mapSuccessRevision;
}

export function useInitialLatest({ screen, owner, expired = false, fixture = false, pageLaunch = false, enabled = true, supported = true, sync, dogs }) {
  const splash = useSplashState();
  const record = useRef(null);
  const [timedOut, setTimedOut] = useState(null);
  let publication = null;
  try { publication = sync?.getMapPublication?.() ?? null; } catch { /* closed fence */ }
  const eligible = screen === 'map' && !!owner && !expired && !fixture && !pageLaunch
    && enabled && supported && sync?.enabled !== false && sync?.supported !== false;
  const waiting = splash.phase === 'waiting' && eligible;
  const publisher = publication?.owner === owner ? publication : null;
  // Keep a cold fallback on the map until its own accepted snapshot arrives.
  // A different engine/account/page never inherits this launch's failure.
  if (!eligible || (record.current && (record.current.owner !== owner
    || record.current.publisher !== publisher?.scope || record.current.generation !== publisher?.generation)))
    record.current = null;
  if (waiting && !record.current)
    record.current = { owner, publisher: publisher?.scope, generation: publisher?.generation,
      scope: {}, accepted: false, fallback: false };
  const current = record.current;
  if (current && initialLatestAccepted(owner, publication, dogs)) {
    current.accepted = true;
    current.fallback = false;
  }
  const failure = waiting && !current.accepted && (!publication || publisher)
    && !!(sync?.error || sync?.authFailed || dogs?.error);
  if (current && !current.accepted && (failure || timedOut === current.scope)) current.fallback = true;
  const ready = !waiting || current.accepted || current.fallback;
  const phase = !waiting ? 'bypass' : current.accepted ? 'accepted' : current.fallback ? 'fallback' : 'waiting';
  const scope = waiting ? current.scope : null;
  useEffect(() => {
    if (!waiting || ready) return undefined;
    const timer = setTimeout(() => { if (record.current === current) setTimedOut(current.scope); }, INITIAL_LATEST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, ready, current]);
  // Register this frame's scope before the child's passive framing effect.
  // Otherwise an immediate empty/unavailable frame can be erased afterwards.
  useLayoutEffect(() => { reportInitialLatest(scope, phase); }, [scope, phase, current]);
  return { ready, frameScope: scope, phase, mapFailure: !!current?.fallback };
}
