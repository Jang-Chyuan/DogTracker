import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';

// Producer/archive tests explicitly supply a consumer for the immutable,
// verified SQLite readback. Actual React commit and missing-consumer behavior
// are exercised separately by CloudLatestPriority/CloudLatestHistoryPriority.
export function createIndependentCloudSyncWithCommittedMapReader(options) {
  let engine;
  engine = createIndependentCloudSync({ ...options, onChange: state => {
    options.onChange?.(state);
    const publication = engine?.mapPublication();
    const readback = publication?.readback;
    if (readback && !publication.pending && !publication.busy
      && readback.snapshot.verified && readback.owner === publication.owner
      && readback.scope === publication.scope && readback.generation === publication.generation
      && readback.attempt === publication.attempt && readback.revision === publication.mapSuccessRevision)
      publication.acknowledgeMapRead(readback);
  } });
  return engine;
}
