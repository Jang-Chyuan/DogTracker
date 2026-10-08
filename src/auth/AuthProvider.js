import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../services/supabase';
import { NativeModules } from 'react-native';
import { cancelBackgroundSync } from '../cloud/CloudSyncSlot';
import { isNetworkFailure } from '../cloud/CloudErrors';
import { RESTORE_TIMEOUT_MS } from '../app/Launch';

const AuthContext = createContext(null);

// Supabase refused the refresh token itself (revoked, expired, unknown
// session): 400/401/403 with an auth error, never 429 or 5xx.
export function refreshRefused(failure) {
  const status = Number(failure?.status);
  const words = `${failure?.code || ''} ${failure?.message || ''}`;
  if (status === 429 || status >= 500) return false;
  if ([400, 401, 403].includes(status)) return true;
  return /refresh_token_not_found|refresh_token_already_used|session_not_found|session_expired|invalid refresh token|invalid_grant|bad_jwt/i.test(words);
}

export function AuthProvider({ children, clientFactory = getSupabase, restoreTimeout = RESTORE_TIMEOUT_MS }) {
  const [connection] = useState(() => {
    try { return { client: clientFactory() }; }
    catch (failure) { return { error: failure.message || '無法初始化登入服務' }; }
  });
  const client = connection.client;
  const [session, setSession] = useState(null);
  // Restoring the saved sign-in (under D0).
  const [loading, setLoading] = useState(!!client);
  // The restore ran past RESTORE_TIMEOUT_MS: the app opens on the map anyway.
  const [timedOut, setTimedOut] = useState(false);
  // The restore could not reach Supabase: the saved sign-in is kept and the
  // client retries by itself (S3 「暫時連不上，會自動重試」).
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(connection.error || '');
  // 登入失效: the session ended without this phone signing out (the refresh
  // token was refused), in use or found by the restore. Signing in clears it.
  const [expired, setExpired] = useState(false);
  // The restore itself found the sign-in refused, before the app opened:
  // D1 「需要重新登入」 instead of the map (判定表「啟動與恢復登入」).
  const [expiredAtStart, setExpiredAtStart] = useState(false);
  const signedIn = useRef(false), signingOut = useRef(false), checking = useRef(null);
  // The app has opened (restore finished or timed out): a refusal from now
  // on is 登入失效 in use (S3, the gear's red dot), never D1.
  const opened = useRef(!client), waitingOnline = useRef(false);
  // A sign-in 「稍後再說」 cancelled while in flight (D1): its late result is
  // not taken. `discarding` is the settling of that attempt.
  const attempt = useRef(null), discarding = useRef(null);

  useEffect(() => {
    if (!client) return undefined;
    let alive = true, eventSeen = false;
    const finish = () => {
      if (!alive || opened.current) return;
      opened.current = true;
      setLoading(false);
    };
    const receive = (event, next) => {
      if (!alive) return;
      // The sign-in cancelled with 「稍後再說」 landed anyway: not taken
      // (it is signed out again as soon as it resolves).
      if (next?.user && discarding.current) return;
      if (!next?.user) {
        // Background work stops here as well as in the sync/upload hooks, so
        // it does not depend on them receiving one more render.
        cancelBackgroundSync();
        NativeModules.CloudBackgroundSync?.setOwner(null).catch(() => {});
        NativeModules.BleBackground?.executeDatabase?.(
          "UPDATE ble_upload_meta SET value='' WHERE key='owner'", '[]',
        ).catch(() => {});
      }
      if (next?.user) {
        setExpired(false); setExpiredAtStart(false); setOffline(false);
        waitingOnline.current = false;
      } else if (event === 'SIGNED_OUT' && !signingOut.current
        && (signedIn.current || waitingOnline.current || !opened.current)) {
        // Supabase removed a saved session itself: refused at the restore
        // (before the app opened → D1), or later (in use).
        setExpired(true);
        if (!opened.current) setExpiredAtStart(true);
        setOffline(false);
        waitingOnline.current = false;
      }
      signedIn.current = !!next?.user;
      setSession(next); setError('');
      if (next?.user) finish();
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((event, next) => {
      eventSeen = true;
      receive(event, next);
    });
    client.auth.getSession().then(({ data, error: failure }) => {
      if (!alive) return;
      if (failure && isNetworkFailure(failure)) {
        // The saved sign-in is still there; the client refreshes it once it
        // reaches Supabase.
        waitingOnline.current = true;
        setOffline(true);
      } else {
        // Nothing saved, or restored: not waiting for anything.
        waitingOnline.current = false;
        setOffline(false);
        if (failure) setError('無法恢復登入狀態，請重新登入');
      }
      // An older restore result must not undo a newer login/logout event.
      if (!eventSeen && !failure) receive('INITIAL_SESSION', data.session);
      // A refusal found by the restore reaches the listeners right after it
      // (Supabase queues it until the restore ends): one more turn first.
      setTimeout(finish, 0);
    }).catch(() => {
      if (!alive) return;
      if (!eventSeen) setError('無法讀取登入狀態');
      setTimeout(finish, 0);
    });
    // D0 waits for the restore this long, then the map opens without it.
    const timer = setTimeout(() => {
      if (alive && !opened.current) { setTimedOut(true); setOffline(true); waitingOnline.current = true; finish(); }
    }, restoreTimeout);
    return () => { alive = false; clearTimeout(timer); subscription.unsubscribe(); };
  }, [client, restoreTimeout]);

  const requireClient = () => {
    if (!client) throw new Error(connection.error || '登入服務尚未就緒');
    return client;
  };
  const value = {
    session, user: session?.user || null, loading, error, expired, available: !!client,
    // The restore ran past RESTORE_TIMEOUT_MS, and whether it still waits
    // for Supabase (the saved sign-in is kept; S3 「暫時連不上，會自動重試」).
    timedOut, restoring: !session?.user && (loading || offline),
    expiredAtStart,
    async signIn(email, password) {
      const address = email.trim();
      if (!address || !password) throw new Error('請輸入電子郵件和密碼');
      const auth = requireClient().auth;
      // Registered before waiting, so 「稍後再說」 can cancel it meanwhile.
      const mine = { cancelled: false, task: null };
      attempt.current = mine;
      // A cancelled attempt still on its way settles (and is signed out)
      // first, so it cannot sign this one out.
      while (discarding.current) await discarding.current;
      if (mine.cancelled) throw cancelledSignIn();
      mine.task = auth.signInWithPassword({ email: address, password });
      try {
        const { data, error: failure } = await mine.task;
        if (mine.cancelled) throw cancelledSignIn();
        if (failure) throw failure;
        return data;
      } finally {
        if (attempt.current === mine) attempt.current = null;
      }
    },
    /**
     * 「稍後再說」 during a sign-in (D1): the attempt is dropped. If Supabase
     * still signs in, that session is not taken: it is signed out here
     * (locally, so it is not 登入失效) and nothing follows it meanwhile.
     */
    cancelSignIn() {
      const current = attempt.current;
      if (!current || current.cancelled) return;
      current.cancelled = true;
      attempt.current = null;
      // Still waiting for an earlier one: it never reaches Supabase.
      if (!current.task) return;
      const settle = Promise.resolve(current.task).then(async result => {
        if (!result?.data?.session) return;
        signingOut.current = true;
        try { await client.auth.signOut({ scope: 'local' }); } finally { signingOut.current = false; }
      }).catch(() => {}).finally(() => {
        if (discarding.current === settle) discarding.current = null;
      });
      discarding.current = settle;
    },
    /** A session from a cancelled sign-in, which no one may follow. */
    isDiscarded: next => !!next?.user && !!discarding.current,
    /**
     * An upload or download was refused for the sign-in (401 / expired JWT).
     * One refresh decides: a new session means the token had only run out;
     * no network says nothing; a refused refresh ends the session here, which
     * reads as 登入失效 (S3 「需要重新登入」, the gear's red dot) — not D1.
     * Resolves true when the sign-in ended.
     */
    reportAuthFailure() {
      if (!client || !signedIn.current) return Promise.resolve(false);
      if (checking.current) return checking.current;
      checking.current = (async () => {
        try {
          const { data, error: failure } = await client.auth.refreshSession();
          if (!failure && data?.session?.user) return false;
          // Only an explicit refusal of the refresh token ends the sign-in;
          // no network, throttling (429), server errors or anything unknown
          // keep it and the next pass asks again.
          if (!failure || isNetworkFailure(failure) || !refreshRefused(failure)) return false;
          if (!signedIn.current) return true;
          // Not a user sign-out: receive(null) marks it expired.
          await client.auth.signOut({ scope: 'local' }).catch(() => {});
          setExpired(true);
          return true;
        } catch (failure) {
          return false;
        } finally { checking.current = null; }
      })();
      return checking.current;
    },
    async signOut() {
      signingOut.current = true;
      try {
        const { error: failure } = await requireClient().auth.signOut({ scope: 'local' });
        if (failure) throw failure;
      } finally { signingOut.current = false; }
    },
  };
  // AppState refresh and background scheduling remain owned by useCloudSync.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// What signIn rejects with after 「稍後再說」 cancelled it: nothing to show.
function cancelledSignIn() {
  const failure = new Error('登入已取消');
  failure.cancelled = true;
  return failure;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return context;
}

export default AuthProvider;
