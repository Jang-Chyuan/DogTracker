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
