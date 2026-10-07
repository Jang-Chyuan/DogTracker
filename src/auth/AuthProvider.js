import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getSupabase } from '../services/supabase';
import { NativeModules } from 'react-native';
import { cancelBackgroundSync } from '../cloud/CloudSyncSlot';

const AuthContext = createContext(null);

export function AuthProvider({ children, clientFactory = getSupabase }) {
  const [connection] = useState(() => {
    try { return { client: clientFactory() }; }
    catch (failure) { return { error: failure.message || '無法初始化登入服務' }; }
  });
  const client = connection.client;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!!client);
  const [error, setError] = useState(connection.error || '');
  // 登入失效 while in use: the session ended without this phone signing out
  // (the refresh token was refused). Signing in again clears it.
  const [expired, setExpired] = useState(false);
  const signedIn = useRef(false), signingOut = useRef(false);

  useEffect(() => {
    if (!client) return undefined;
    let alive = true, eventSeen = false;
    const receive = next => {
      if (!alive) return;
      if (!next?.user) {
        // Background work stops here as well as in the sync/upload hooks, so
        // it does not depend on them receiving one more render.
        cancelBackgroundSync();
        NativeModules.CloudBackgroundSync?.setOwner(null).catch(() => {});
        NativeModules.BleBackground?.executeDatabase?.(
          "UPDATE ble_upload_meta SET value='' WHERE key='owner'", '[]',
        ).catch(() => {});
      }
      if (next?.user) setExpired(false);
      else if (signedIn.current && !signingOut.current) setExpired(true);
      signedIn.current = !!next?.user;
      setSession(next); setError(''); setLoading(false);
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      eventSeen = true;
      receive(next);
    });
    client.auth.getSession().then(({ data, error: failure }) => {
      // An older restore result must not undo a newer login/logout event.
      if (!alive || eventSeen) return;
      if (failure) setError('無法恢復登入狀態，請重新登入');
      else receive(data.session);
      setLoading(false);
    }).catch(() => {
      if (alive && !eventSeen) { setError('無法讀取登入狀態'); setLoading(false); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [client]);

  const requireClient = () => {
    if (!client) throw new Error(connection.error || '登入服務尚未就緒');
    return client;
  };
  const value = {
    session, user: session?.user || null, loading, error, expired, available: !!client,
    async signIn(email, password) {
      const address = email.trim();
      if (!address || !password) throw new Error('請輸入 Email 與密碼');
      const { data, error: failure } = await requireClient().auth.signInWithPassword({ email: address, password });
      if (failure) throw failure;
      return data;
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return context;
}

export default AuthProvider;
