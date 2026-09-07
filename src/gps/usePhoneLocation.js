import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import NativeTrackingPlatform from '../../specs/NativeTrackingPlatform';
import { getErrorMessage } from '../utils/errors';
import {
  readLocationPermission,
  requestLocationPermission,
} from './LocationService';

// Only manages permission/service status. Google Maps owns acquisition; phone
// coordinates never enter the tracking DB or repositories.
export function usePhoneLocation(
  foreground,
  platform = NativeTrackingPlatform,
  promptOnFirstUse = false,
) {
  const [state, setState] = useState({
    permission: 'checking',
    services: false,
    busy: false,
    error: null,
  });
  const generation = useRef(0);
  const busy = useRef(false);
  const active = useRef(false);
  const permissionRequest = useRef(null);
  const refresh = useCallback(
    async (request = false) => {
      if (!active.current || busy.current) return;
      busy.current = true;
      const token = generation.current;
      const alive = () => active.current && generation.current === token;
      setState(value => ({ ...value, busy: true, error: null }));
      try {
        if (Platform.OS !== 'android' || !platform) {
          if (alive())
            setState({
              permission: 'unsupported',
              services: false,
              busy: false,
              error: null,
            });
          return;
        }
        let permission = await readLocationPermission();
        let requested = request;
        if (!alive()) return;
        if (permissionRequest.current) {
          // The Android permission dialog can pause/resume the Activity. A new
          // foreground refresh must await that result, not start another dialog
          // or publish the pre-dialog denied state after a successful grant.
          requested = true;
          permission = await permissionRequest.current;
        } else if (permission === 'denied' && (request || promptOnFirstUse)) {
          const firstRequest = await platform.claimLocationPermissionPrompt();
          if (!alive()) return;
          if (request || firstRequest) {
            requested = true;
            const task = requestLocationPermission();
            permissionRequest.current = task;
            try {
              permission = await task;
            } finally {
              if (permissionRequest.current === task)
                permissionRequest.current = null;
            }
          }
        }
        const services = await platform.locationServicesEnabled();
        if (alive())
          setState(value => ({
            permission:
              !requested &&
              permission === 'denied' &&
              value.permission === 'blocked'
                ? 'blocked'
                : permission,
            services,
            busy: false,
            error: null,
          }));
      } catch (error) {
        if (alive())
          setState(value => ({
            ...value,
            services: false,
            busy: false,
            error: getErrorMessage(error),
          }));
      } finally {
        if (generation.current === token) busy.current = false;
      }
    },
    [platform, promptOnFirstUse],
  );
  useEffect(() => {
    active.current = foreground;
    generation.current += 1;
    busy.current = false;
    if (foreground) refresh();
    return () => {
      active.current = false;
      generation.current += 1;
      busy.current = false;
    };
  }, [foreground, refresh]);
  async function openSettings() {
    const token = generation.current;
    try {
      if (
        !state.services &&
        ['precise', 'approximate'].includes(state.permission)
      )
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      else await Linking.openSettings();
    } catch (error) {
      if (active.current && generation.current === token)
        setState(value => ({ ...value, error: getErrorMessage(error) }));
    }
  }
  return {
    ...state,
    enabled:
      foreground &&
      !state.busy &&
      !state.error &&
      state.services &&
      ['precise', 'approximate'].includes(state.permission),
    requestPermission: () => refresh(true),
    retry: () => refresh(),
    openSettings,
  };
}
