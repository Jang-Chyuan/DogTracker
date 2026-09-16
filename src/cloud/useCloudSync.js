import { useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { getCloudClient } from './CloudClient';
import { createCloudSync } from './CloudSync';
import { cloudBackground, requestCloudNotificationPermission } from './CloudBackground';
import { createCloudExecution } from './CloudExecution';

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
    const sync = createCloudSync({ client, database, onChange: value => {
      setStatus(current => ({ ...current, ...value }));
      if (value.lastSuccess) cloudBackground?.updateStatus(value.error
        ? '連線或下載失敗，稍後自動重試'
        : `上次同步 ${new Date(value.lastSuccess).toLocaleTimeString('zh-TW', { hour12: false })}；每 30 秒更新`);
    } });
    const execution = createCloudExecution({ client, sync, native: cloudBackground,
      requestPermission: requestCloudNotificationPermission,
      onState: value => setStatus(current => ({ ...current, ...value })),
    });
    engine.current = sync;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      if (!disposed) execution.setSession(session);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (disposed || eventSeen) return;
      if (error) setStatus(current => ({ ...current, error: '恢復登入失敗，請重新登入' }));
      else execution.setSession(data.session);
    }).catch(() => { if (!disposed) setStatus(current => ({ ...current, error: '無法讀取安全儲存的登入狀態' })); });
    const change = state => {
      execution.setForeground(state === 'active');
    };
    change(AppState.currentState);
    const appSubscription = AppState.addEventListener('change', change);
    const stoppedSubscription = DeviceEventEmitter.addListener('CloudBackgroundStopped', event => execution.stopped(event));
    return () => {
      disposed = true;
      engine.current = null;
      subscription.unsubscribe();
      appSubscription.remove();
      stoppedSubscription.remove();
      execution.dispose();
      sync.dispose()?.catch(() => {});
    };
  }, [database, ready, clientFactory]);
  return { ...status, runManual: (work, abort) => engine.current
    ? engine.current.runManual(work, abort) : Promise.reject(new Error('自動同步尚未就緒')) };
}
