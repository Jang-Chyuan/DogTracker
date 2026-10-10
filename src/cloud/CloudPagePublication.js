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
  const published = () => {
    const value = getPublication();
    return value && { ...value, pending: value.publishedPending !== false };
  };
  const fence = captureMapRead(published, owner, completedMapRevision(before));
  return {
    open: fence.open,
    valid: () => fence.valid() && getPublication()?.publishedRevision === before.publishedRevision,
  };
}
