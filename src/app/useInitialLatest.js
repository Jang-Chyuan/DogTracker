import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { INITIAL_LATEST_WAIT_MS, reportInitialLatest, useSplashState } from './hideSplash';

export { INITIAL_LATEST_WAIT_MS };

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
  // This launch's one wait for the account (INITIAL_LATEST_WAIT_MS from the
  // first moment it waits). Publisher generations change under it at a cold
  // start (the session arriving, the foreground, a retry): each used to start
  // a new 10 s wait, holding the launch screen for 18–37 s.
  const launch = useRef(null);
  const [timedOut, setTimedOut] = useState(null);
  const [capped, setCapped] = useState(null);
  let publication = null;
  try { publication = sync?.getMapPublication?.() ?? null; } catch { /* closed fence */ }
  const eligible = screen === 'map' && !!owner && !expired && !fixture && !pageLaunch
    && enabled && supported && sync?.enabled !== false && sync?.supported !== false;
  const waiting = splash.phase === 'waiting' && eligible;
  if (waiting && launch.current?.owner !== owner)
    launch.current = { owner, deadline: Date.now() + INITIAL_LATEST_WAIT_MS };
  const overdue = waiting && capped === launch.current;
  const publisher = publication?.owner === owner ? publication : null;
  // Keep a cold fallback on the map until its own accepted snapshot arrives.
  // A different engine/account/page never inherits this launch's failure.
  const previous = record.current;
  if (!eligible || (record.current && (record.current.owner !== owner
    || record.current.publisher !== publisher?.scope || record.current.generation !== publisher?.generation)))
    record.current = null;
  if (waiting && !record.current)
    record.current = { owner, publisher: publisher?.scope, generation: publisher?.generation,
      // Past the launch's wait the first map is already being framed (or
      // shown): a replaced publisher keeps that frame's scope, so nothing
      // starts framing (and holding the launch screen) again.
      scope: overdue && previous?.owner === owner ? previous.scope : {}, accepted: false, fallback: false };
  const current = record.current;
  if (current && initialLatestAccepted(owner, publication, dogs)) {
    current.accepted = true;
    current.fallback = false;
  }
  const failure = waiting && !current.accepted && (!publication || publisher)
    && !!(sync?.error || sync?.authFailed || dogs?.error);
  if (current && !current.accepted && (failure || timedOut === current)) current.fallback = true;
  // Past the launch's wait the gate is open whichever publisher is current;
  // the failure notice (mapFailure) stays this publisher's own.
  const ready = !waiting || current.accepted || current.fallback || overdue;
  const phase = !waiting ? 'bypass' : current.accepted ? 'accepted'
    : current.fallback || overdue ? 'fallback' : 'waiting';
  const scope = waiting ? current.scope : null;
  const deadline = launch.current?.deadline;
  useEffect(() => {
    if (!waiting || ready) return undefined;
    const started = launch.current;
    const timer = setTimeout(() => {
      if (launch.current !== started) return;
      setCapped(started);
      if (record.current === current) setTimedOut(current);
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [waiting, ready, current, deadline]);
  // Register this frame's scope before the child's passive framing effect.
  // Otherwise an immediate empty/unavailable frame can be erased afterwards.
  useLayoutEffect(() => { reportInitialLatest(scope, phase); }, [scope, phase, current]);
  return { ready, frameScope: scope, phase, mapFailure: !!current?.fallback };
}
