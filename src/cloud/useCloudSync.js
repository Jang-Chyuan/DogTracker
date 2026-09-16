import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getCloudClient } from './CloudClient';
import { createCloudSync } from './CloudSync';

export function useCloudSync(database, ready, clientFactory = getCloudClient) {
  const engine = useRef(null);
  const [status, setStatus] = useState({ busy: false, error: '', revision: 0 });
  useEffect(() => {
    if (!ready) return undefined;
    let client;
    try { client = clientFactory(); }
    catch { setStatus(current => ({ ...current, error: '雲端登入設定無法載入' })); return undefined; }
    let disposed = false;
    let eventSeen = false;
    const sync = createCloudSync({ client, database, onChange: setStatus });
    engine.current = sync;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      if (!disposed) sync.setSession(session);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) setStatus(current => ({ ...current, error: '恢復登入失敗，請重新登入' }));
      else sync.setSession(data.session);
    }).catch(() => { if (!disposed) setStatus(current => ({ ...current, error: '無法讀取安全儲存的登入狀態' })); });
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
      sync.dispose()?.catch(() => {});
      client.auth.stopAutoRefresh();
    };
  }, [database, ready, clientFactory]);
  return { ...status, runManual: (work, abort) => engine.current
    ? engine.current.runManual(work, abort) : Promise.reject(new Error('自動同步尚未就緒')) };
}
