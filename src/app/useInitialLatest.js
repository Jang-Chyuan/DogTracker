import { useEffect, useRef, useState } from 'react';
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
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [timedOut, setTimedOut] = useState(null);
  let publication = null;
  try { publication = sync?.getMapPublication?.() ?? null; } catch { /* closed fence */ }
  const waiting = splash.phase === 'waiting' && screen === 'map' && !!owner && !expired && !fixture && !pageLaunch
    && enabled && supported && sync?.enabled !== false && sync?.supported !== false;
  const publisher = publication?.owner === owner ? publication : null;
  if (waiting && (!record.current || record.current.owner !== owner
    || record.current.publisher !== publisher?.scope || record.current.generation !== publisher?.generation))
    record.current = { owner, publisher: publisher?.scope, generation: publisher?.generation, scope: {}, accepted: false, proceeded: false };
  if (!waiting) record.current = null;
  const current = record.current;
  if (waiting && initialLatestAccepted(owner, publication, dogs)) current.accepted = true;
  if (waiting && splash.latest?.scope === current.scope && splash.latest.phase === 'proceed') current.proceeded = true;
  const ready = !waiting || current.accepted || current.proceeded;
  const failure = waiting && (!publication || publisher) && !!(sync?.error || sync?.authFailed || dogs?.error);
  const phase = !waiting ? 'bypass' : current.accepted ? 'accepted' : current.proceeded ? 'proceed'
    : failure || timedOut === current.scope ? 'fallback' : 'waiting';
  const scope = waiting ? current.scope : null;
  useEffect(() => {
    if (!waiting || ready || failure) return undefined;
    const timer = setTimeout(() => { if (record.current === current) setTimedOut(current.scope); }, INITIAL_LATEST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, ready, failure, current]);
  useEffect(() => { reportInitialLatest(scope, phase, () => mounted.current && record.current === current); }, [scope, phase, current]);
  return { ready, frameScope: scope, phase };
}
