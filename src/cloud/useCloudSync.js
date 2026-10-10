import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { getCloudClient } from './CloudClient';
import { createCloudSync } from './CloudSync';

// Foreground uses the existing 30-second scheduler; Android WorkManager owns
// bounded background passes. Do not cancel durable jobs on a React unmount.
// `onAuthFailure`: a pass was refused for the sign-in (401 / expired JWT);
// AuthProvider.reportAuthFailure decides whether the sign-in really ended.
// `isDiscarded(session)`: a sign-in cancelled with 「稍後再說」 (D1) that
// landed anyway; it is not followed (AuthProvider signs it out at once).
export function useCloudSync(database, ready, clientFactory = getCloudClient, onAuthFailure = null,
  isDiscarded = null) {
  const engine = useRef(null);
  const getMapPublication = useCallback(() => engine.current?.mapPublication() ?? null, []);
  const getHistoryPublication = useCallback(() => engine.current?.historyPublication() ?? null, []);
  const authFailure = useRef(onAuthFailure);
  authFailure.current = onAuthFailure;
  const discarded = useRef(isDiscarded);
  discarded.current = isDiscarded;
  const [ownerId, setOwnerId] = useState(null);
  const [status, setStatus] = useState({ busy: false, error: '', revision: 0, publishedRevision: 0, publishedPending: false });
  useEffect(() => {
    if (!ready) return undefined;
    let client;
    try { client = clientFactory(); }
    catch { setStatus(current => ({ ...current, error: t("c596") })); return undefined; }
    let disposed = false;
    let eventSeen = false;
    let refused = false;
    const sync = createCloudSync({ client, database, onChange: value => {
      setStatus(current => ({ ...current, ...value }));
      // Once per refusal, not on every later publish of the same state.
      if (value.authFailed && !refused) authFailure.current?.();
      refused = !!value.authFailed;
    } });
    engine.current = sync;
    const sessionChanged = session => {
      const owner = session?.user?.id || null;
      setOwnerId(owner);
      sync.setSession(session);
      NativeModules.CloudBackgroundSync?.setOwner(owner).catch(() => {
        if (!disposed) setStatus(current => ({ ...current, error: t("c595") }));
      });
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      if (!disposed && !discarded.current?.(session)) sessionChanged(session);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) setStatus(current => ({ ...current, error: t("c597") }));
      else sessionChanged(data.session);
    }).catch(() => { if (!disposed) setStatus(current => ({ ...current, error: t("c598") })); });
    // Continuous token refresh follows the UI. WorkManager restores/refreshes
    // the session only during its bounded task.
    const change = state => {
      const active = state === 'active';
      if (active) client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
      sync.setForeground(active);
    };
    change(AppState.currentState);
    const appSubscription = AppState.addEventListener('change', change);
    return () => {
      disposed = true;
      engine.current = null;
      subscription.unsubscribe();
      appSubscription.remove();
      client.auth.stopAutoRefresh();
      sync.dispose()?.catch(() => {});
    };
  }, [database, ready, clientFactory]);
  return { ...status, ownerId, getMapPublication, getHistoryPublication, retry: () => engine.current?.retry(), runManual: (work, abort) => engine.current
    ? engine.current.runManual(work, abort) : Promise.reject(new Error(t("c599"))) };
}
