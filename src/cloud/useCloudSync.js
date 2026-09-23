import { useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { getCloudClient } from './CloudClient';
import { createCloudSync } from './CloudSync';

// Foreground uses the existing 30-second scheduler; Android WorkManager owns
// bounded background passes. Do not cancel durable jobs on a React unmount.
export function useCloudSync(database, ready, clientFactory = getCloudClient) {
  const engine = useRef(null);
  const [ownerId, setOwnerId] = useState(null);
  const [status, setStatus] = useState({ busy: false, error: '', revision: 0 });
  useEffect(() => {
    if (!ready) return undefined;
    let client;
    try { client = clientFactory(); }
    catch { setStatus(current => ({ ...current, error: '雲端登入設定無法載入' })); return undefined; }
    let disposed = false;
    let eventSeen = false;
    const sync = createCloudSync({ client, database, onChange: value => {
      setStatus(current => ({ ...current, ...value }));
    } });
    engine.current = sync;
    const sessionChanged = session => {
      const owner = session?.user?.id || null;
      setOwnerId(owner);
      sync.setSession(session);
      NativeModules.CloudBackgroundSync?.setOwner(owner).catch(() => {
        if (!disposed) setStatus(current => ({ ...current, error: '背景同步排程失敗，前景同步仍可使用' }));
      });
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      if (!disposed) sessionChanged(session);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) setStatus(current => ({ ...current, error: '恢復登入失敗，請重新登入' }));
      else sessionChanged(data.session);
    }).catch(() => { if (!disposed) setStatus(current => ({ ...current, error: '無法讀取安全儲存的登入狀態' })); });
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
  return { ...status, ownerId, runManual: (work, abort) => engine.current
    ? engine.current.runManual(work, abort) : Promise.reject(new Error('自動同步尚未就緒')) };
}
