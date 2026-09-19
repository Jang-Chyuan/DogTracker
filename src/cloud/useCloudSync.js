import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getCloudClient } from './CloudClient';
import { createCloudSync } from './CloudSync';

/**
 * Cloud sync runs only while the App is on screen.
 *
 * It used to keep a dataSync foreground service alive so a 30 second JS timer
 * could go on downloading with the screen off. React Native's headless task
 * holds a PARTIAL_WAKE_LOCK for as long as the task runs, and that task only
 * ended when the service did, so the CPU was never allowed to sleep: a night in
 * the background emptied the battery (4h24m of wake lock, 1h47m of CPU). The
 * rows stay in Supabase either way, so leaving the App now stops the scheduler
 * and coming back downloads what was missed.
 */
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
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      if (!disposed) { setOwnerId(session?.user?.id || null); sync.setSession(session); }
    });
    client.auth.getSession().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) setStatus(current => ({ ...current, error: '恢復登入失敗，請重新登入' }));
      else { setOwnerId(data.session?.user?.id || null); sync.setSession(data.session); }
    }).catch(() => { if (!disposed) setStatus(current => ({ ...current, error: '無法讀取安全儲存的登入狀態' })); });
    // Token refresh follows the scheduler: refreshing in the background would
    // be another timer keeping the runtime busy for downloads nobody is doing.
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
