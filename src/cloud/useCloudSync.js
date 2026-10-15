import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { getCloudClient } from './CloudClient';
import { createCloudSync } from './CloudSync';
import { createCloudAuthRefreshLifecycle } from './CloudAuthRefreshLifecycle';
import { storedSignIn } from './CloudSession';

export const AUTH_REPORT_REPEAT_MS = 5 * 60000;

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
    let refused = false, reportedAt = 0;
    const sync = createCloudSync({ client, database, onChange: value => {
      setStatus(current => ({ ...current, ...value }));
      // Once per refusal, not on every later publish or attempt of the same
      // state (it stays set until an attempt succeeds). A refusal that lasts
      // is asked about again every AUTH_REPORT_REPEAT_MS: the verdict of a
      // refresh that found no network earlier may have changed.
      const at = Date.now();
      if (value.authFailed && (!refused || at - reportedAt >= AUTH_REPORT_REPEAT_MS)) {
        reportedAt = at;
        authFailure.current?.();
      }
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
    // No session from the SDK is not always signed out: a cold start offline
    // after the access token expired has none until the refresh reaches
    // Supabase, though the sign-in is still stored. The map then keeps
    // following that account (its downloaded dogs, read offline); the SDK's
    // refresh later reports the same owner, and a sign-out or refused refresh
    // removes the stored session first, so it still ends the owner.
    let lookup = 0;
    const receive = (event, session, failed = false) => {
      const seen = ++lookup;
      if (session?.user || event === 'SIGNED_OUT') { sessionChanged(session); return; }
      storedSignIn(client.auth).then(stored => {
        // A failed restore with nothing stored leaves the owner unknown, as before.
        if (!disposed && seen === lookup && (stored || !failed)) sessionChanged(stored);
      });
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      eventSeen = true;
      if (!disposed && !discarded.current?.(session)) receive(event, session);
    });
    // Offline, the SDK's first answer waits for its refresh retries (about
    // 30 s) before it reports anything. The stored account is read at once
    // meanwhile, so its downloaded dogs are on the map from the start; any
    // answer of the SDK (a refreshed session, a sign-out) replaces it.
    const early = lookup;
    storedSignIn(client.auth).then(stored => {
      if (stored && !disposed && !eventSeen && early === lookup) sessionChanged(stored);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) setStatus(current => ({ ...current, error: t("c597") }));
      receive('INITIAL_SESSION', error ? null : data.session, !!error);
    }).catch(() => { if (!disposed) setStatus(current => ({ ...current, error: t("c598") })); });
    // Continuous token refresh follows the UI. WorkManager restores/refreshes
    // the session only during its bounded task.
    const refresh = createCloudAuthRefreshLifecycle(client.auth);
    const change = state => {
      const active = state === 'active';
      refresh.setForeground(active);
      sync.setForeground(active);
    };
    change(AppState.currentState);
    const appSubscription = AppState.addEventListener('change', change);
    return () => {
      disposed = true;
      engine.current = null;
      subscription.unsubscribe();
      appSubscription.remove();
      refresh.close();
      sync.dispose()?.catch(() => {});
    };
  }, [database, ready, clientFactory]);
  return { ...status, ownerId, getMapPublication, getHistoryPublication, retry: () => engine.current?.retry(), runManual: (work, abort) => engine.current
    ? engine.current.runManual(work, abort) : Promise.reject(new Error(t("c599"))) };
}
