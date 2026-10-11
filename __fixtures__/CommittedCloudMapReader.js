import { createCloudSync } from '../src/cloud/CloudSync';

// Producer/archive tests explicitly supply a consumer for the immutable,
// verified SQLite readback. Actual React commit and missing-consumer behavior
// are exercised separately by CloudLatestPriority/CloudLatestHistoryPriority.
export function createCloudSyncWithCommittedMapReader(options) {
  let engine;
  engine = createCloudSync({ ...options, onChange: state => {
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
