// SQLite-parsed JSON only: this immutable in-memory readback never enters
// diagnostics. Its identity is the producer/consumer acknowledgement token.
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
export function createMapReadback(snapshot, proof, isCurrent) {
  const value = Object.freeze({ ...proof, snapshot: freeze(snapshot) });
  let accepted = false, complete;
  return {
    value,
    acknowledged: () => accepted,
    acknowledge(candidate) {
      if (candidate !== value || !isCurrent()) return false;
      accepted = true;
      complete?.(true);
      return true;
    },
    wait(signal, budget) {
      if (!isCurrent() || signal.aborted) return Promise.resolve(false);
      if (accepted) return Promise.resolve(true);
      return new Promise(resolve => {
        const stop = () => finish(false);
        const timer = setTimeout(stop, budget);
        const finish = result => {
          clearTimeout(timer);
          signal.removeEventListener('abort', stop);
          if (complete === finish) complete = null;
          resolve(result && isCurrent() && !signal.aborted);
        };
        complete = finish;
        signal.addEventListener('abort', stop, { once: true });
        // Registration itself must not miss an abort or a synchronous ACK.
        if (signal.aborted || !isCurrent()) finish(false);
        else if (accepted) finish(true);
      });
    },
  };
}

// This gate is consulted before a session queues archive initialization.
// It never interrupts an already-started native command or certifies history.
export function createLatestReadinessGate(current, budget = 10000) {
  const listeners = new Set();
  let closed = false;
  return {
    ready: () => !closed && current().ready,
    notify() { for (const listener of [...listeners]) listener(); },
    close() { closed = true; this.notify(); },
    wait(signal, expectedOwner = undefined) {
      const before = current();
      if (expectedOwner !== undefined && before.owner !== expectedOwner) return Promise.resolve(false);
      if (closed || signal.aborted) return Promise.resolve(false);
      if (before.ready) return Promise.resolve(true);
      return new Promise(resolve => {
        const finish = value => {
          clearTimeout(timer);
          listeners.delete(check);
          signal.removeEventListener('abort', stop);
          resolve(value);
        };
        const stop = () => finish(false);
        const timer = setTimeout(stop, budget);
        const check = () => {
          const next = current();
          if (closed || signal.aborted || before.owner !== next.owner || before.generation !== next.generation) finish(false);
          else if (next.ready) finish(true);
        };
        listeners.add(check);
        signal.addEventListener('abort', stop, { once: true });
        check();
      });
    },
  };
}
