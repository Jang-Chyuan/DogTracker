import { useCloudDogs } from '../cloud/useCloudDogs';
import { completedMapRevision, mapDownloadBusy, mapReadRevision } from '../cloud/CloudPublication';

// A verified latest readback uses its own store and React consumer. Local BLE,
// hold/context and offline archive bootstrap still require the real local DB.
// This admission does not change launch, preferences, receiver or framing gates.
export function useAppCloudDogs(tracking, sync, { active = true } = {}) {
  const localReady = tracking.ready.real;
  const ready = tracking.cloudDatabase.latestStorageIsolated ? tracking.cloudReady : localReady;
  return useCloudDogs(tracking.cloudDatabase, sync.ownerId, ready, undefined, null, {
    active,
    contextEnabled: localReady,
    latestFirst: sync.latestFirst,
    revision: mapReadRevision(sync),
    cloudBusy: mapDownloadBusy(sync) || sync.catchUp?.phase === 'catching-up',
    cloudSuccess: completedMapRevision(sync),
    getMapPublication: sync.getMapPublication,
  });
}
