// Separates Android service lifetime from auth and the single JS sync scheduler.
export function createCloudExecution({ client, sync, native, requestPermission = async () => {},
  onState = () => {} }) {
  let active = false;
  let owner = null;
  let background = false;
  let disposed = false;
  let starting = false;
  let epoch = 0;
  let error = '';
  const apply = () => {
    if (disposed) return;
    const enabled = active || (!!owner && background);
    if (enabled) client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
    sync.setForeground(enabled);
    onState({ backgroundEnabled: background, backgroundError: error });
  };
  async function start() {
    if (disposed || !native || !active || !owner || background || starting) return;
    starting = true;
    const version = epoch;
    try {
      await requestPermission();
      if (disposed || !owner || !active || version !== epoch) return;
      await native.start();
      if (disposed || !owner || version !== epoch) { native.stop(); return; }
      background = true;
      error = '';
    } catch {
      if (!disposed && version === epoch) error = '背景同步啟動失敗，目前只在前景同步；回到 App 後重試';
    } finally {
      starting = false;
      apply();
    }
  }
  return {
    setSession(session) {
      owner = session?.user.id || null;
      sync.setSession(session);
      if (!owner) {
        epoch += 1;
        background = false;
        error = '';
        native?.stop();
      }
      apply();
      // Never invoke Supabase async methods inside an auth callback.
      // Service start is native-only; the scheduler defers its first query.
      start();
    },
    setForeground(value) {
      active = value;
      apply();
      if (active) start();
    },
    stopped(event) {
      if (disposed) return;
      epoch += 1;
      background = false;
      if (owner) error = event.reason || '背景同步已停止，回到 App 後重試';
      apply();
    },
    dispose() {
      disposed = true;
      epoch += 1;
      native?.stop();
      client.auth.stopAutoRefresh();
    },
  };
}
