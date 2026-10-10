import { captureMapRead, completedMapRevision } from './CloudPublication';

// Published-table readers have a separate commit fence: a manual window can
// finish while auto is still downloading. Never reuse that proof for live map.
// Old databases without durable publication keep the stricter map contract.
export function capturePageRead(getPublication, owner, publishedReads = false) {
  const initial = getPublication?.();
  const before = initial && { ...initial };
  const versioned = publishedReads && Number.isFinite(before?.publishedRevision)
    && typeof before?.publishedPending === 'boolean';
  if (!versioned || !owner || !getPublication)
    return captureMapRead(getPublication, owner, completedMapRevision(before));
  const matches = value => value?.owner === owner && value.publishedPending === false
    && value.scope === before.scope && value.generation === before.generation
    && value.publishedRevision === before.publishedRevision;
  // Auto attempts and live-map success may change without changing any
  // published rows. They are not a reason to discard a coherent page read.
  return {
    open: matches(before),
    valid: () => matches(before) && matches(getPublication()),
  };
}
