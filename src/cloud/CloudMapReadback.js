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
