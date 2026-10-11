// Zero is the initial/account-reset generation, not a completed download.
// Older callers without the generation retain their timestamp contract.
export function completedMapRevision(sync) {
  if (sync?.mapSuccessRevision != null)
    return sync.mapSuccessRevision > 0 ? sync.mapSuccessRevision : null;
  return sync?.lastSuccess ?? null;
}

// Capture before any await; check against the scheduler itself afterwards,
// rather than the last React-rendered busy value. No getter is the legacy
// reader contract; a provided getter returning null is a closed owner fence.
export function captureMapRead(getPublication, owner, success) {
  const before = getPublication?.();
  const legacyOrLocal = !getPublication || !owner;
  const matches = value => value?.owner === owner && !value.pending
    && completedMapRevision(value) === success;
  return {
    open: legacyOrLocal || matches(before),
    valid() {
      if (legacyOrLocal) return true;
      const current = getPublication();
      return matches(before) && matches(current)
        && before.scope === current.scope && before.generation === current.generation && before.attempt === current.attempt;
    },
  };
}


// History may be downloading for minutes after the latest map is usable.
export function mapDownloadBusy(sync) {
  return sync?.latestFirst ? !!sync.snapshotPending : !!sync?.busy;
}
export function mapReadRevision(sync) {
  return sync?.latestFirst ? (sync.snapshotRevision ?? 0) * 2 + (sync.snapshotBaseRevision != null ? 1 : 0) : sync?.revision ?? 0;
}


// The live map can finish before local/archive route catch-up. Only an
// atomically applied snapshot from this exact foreground/account may do so.
// Later optional context publications may be pending or awaiting their hold
// reread; they do not revoke that proof. snapshotPending still gates a new
// latest fetch, and a new foreground generation never inherits the old proof.
export function latestMapApplied(sync, owner, dogs) {
  if (!sync?.latestFirst || !owner || sync.error || sync.authFailed || dogs?.error
    || !dogs?.loaded || mapDownloadBusy(sync)) return false;
  let publication;
  try { publication = sync.getMapPublication?.(); } catch { return false; }
  const proof = dogs.cloudPublication;
  const success = completedMapRevision(sync);
  return !!publication && publication.owner === owner && proof?.owner === owner
    && publication.scope != null && proof.scope === publication.scope
    && Number.isSafeInteger(publication.generation) && proof.generation === publication.generation
    && !publication.busy
    && Number.isSafeInteger(success) && success > 0
    && publication.mapSuccessRevision === success
    && Number.isSafeInteger(proof.revision) && proof.revision > 0 && proof.revision <= success
    && dogs.cloudCommit === proof.revision;
}
