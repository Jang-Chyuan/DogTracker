// Foreground mounts share one Supabase auth object. Serialize ticker changes
// across cleanup/remount, without serializing cloud requests or session reads.
const transitions = new WeakMap();
export function createCloudAuthRefreshLifecycle(auth) {
  let desired = null, revision = 0, closed = false;
  // Non-browser SDK initialization starts its own ticker. Applying foreground
  // state after initialization prevents that late start from undoing cleanup.
  // This awaits initialization only, never an unrelated getSession/HTTP pass.
  const initialized = Promise.resolve().then(() => auth.initialize?.()).catch(() => {});
  function enqueue() {
    const version = ++revision;
    const previous = transitions.get(auth) || Promise.resolve();
    const next = previous.then(async () => {
      await initialized;
      if (version !== revision) return;
      if (desired) await auth.startAutoRefresh();
      else await auth.stopAutoRefresh();
    }).catch(() => {
      // Ticker control never fails a session, download or React cleanup. A
      // later lifecycle transition must still be allowed to stop/start it.
    });
    transitions.set(auth, next);
  }
  return {
    setForeground(active) {
      if (closed || desired === active) return;
      desired = active; enqueue();
    },
    close() {
      if (closed) return;
      closed = true; desired = false; enqueue();
    },
  };
}
