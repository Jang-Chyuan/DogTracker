// Zero is the initial/account-reset generation, not a completed download.
// Older callers without the generation retain their timestamp contract.
export function completedMapRevision(sync) {
  if (sync?.mapSuccessRevision != null)
    return sync.mapSuccessRevision > 0 ? sync.mapSuccessRevision : null;
  return sync?.lastSuccess ?? null;
}
