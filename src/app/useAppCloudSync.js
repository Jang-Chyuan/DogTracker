import { useCloudSync } from '../cloud/useCloudSync';

// App admission follows the installed command owner, independently of local
// history migrations. This does not release local data / Splash / map framing.
export function useAppCloudSync(tracking, auth, clientFactory) {
  return useCloudSync(tracking.cloudDatabase, tracking.cloudReady, clientFactory,
    auth.reportAuthFailure, auth.isDiscarded);
}
