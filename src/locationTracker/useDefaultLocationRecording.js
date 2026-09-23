import { useEffect } from 'react';
import { locationTrackerNative } from './LocationTrackerService';

// Permission prompting is owned by usePhoneLocation. The native preference
// defaults to enabled, but an explicit stop survives navigation and restarts.
export function useDefaultLocationRecording(foreground, phone) {
  useEffect(() => {
    if (!foreground || phone.busy || phone.permission !== 'precise' || !phone.services) return;
    locationTrackerNative?.resumeIfEnabled?.().catch(() => {
      // The native module exposes the failure in the recording status page.
    });
  }, [foreground, phone.busy, phone.permission, phone.services]);
}
