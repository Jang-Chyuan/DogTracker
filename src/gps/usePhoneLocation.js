import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
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
  const hasForeground = useRef(false);
  const previousForeground = useRef(foreground);
  const refresh = useCallback(
    async (request = false, resumed = false) => {
      if (!active.current) return;
      if (resumed) {
        // A paused Activity can leave the dialog promise unresolved. Resume
        // reads current system state and invalidates all older async results.
        generation.current += 1;
        busy.current = false;
        permissionRequest.current = null;
      }
      if (busy.current) return;
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
          // Within the same foreground lifetime, do not publish a pre-dialog
          // denial while the user's permission choice is still pending.
          requested = true;
          permission = await permissionRequest.current;
        } else if (!resumed && permission === 'denied' && (request || promptOnFirstUse)) {
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
        const backgroundGranted = permission === 'precise' && (Platform.Version < 29 ||
          await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION));
        if (alive())
          setState(value => ({
            permission:
              !requested &&
              permission === 'denied' &&
              value.permission === 'blocked'
                ? 'blocked'
                : permission,
            services,
            backgroundGranted,
            busy: false,
            error: null,
          }));
      } catch (error) {
        // A failed check (067: e.g. while the Activity comes back from the
        // photo picker or the share sheet) says nothing new about the
        // permission or the location service: keep what was known, with the
        // error, instead of reporting the service off.
        if (alive())
          setState(value => ({
            ...value,
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
    if (foreground) {
      refresh(false, hasForeground.current && !previousForeground.current);
      hasForeground.current = true;
    }
    previousForeground.current = foreground;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') refresh(false, true);
      else {
        generation.current += 1;
        busy.current = false;
      }
    });
    return () => {
      subscription.remove();
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
