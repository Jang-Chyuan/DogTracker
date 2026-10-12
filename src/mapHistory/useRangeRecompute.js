import { useCallback, useEffect, useRef, useState } from 'react';

export const RANGE_RECOMPUTE_DELAY_MS = 32;

// Publish busy first, then compute on a later turn. The latest request wins;
// leaving the date/subject/screen cancels work before it can publish a range.
export function useRangeRecompute(scope, active) {
  const [pending, setPending] = useState(false);
  const timer = useRef(null);
  const owner = useRef({ scope, active });
  owner.current = { scope, active };
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    setPending(false);
  }, []);
  useEffect(() => { cancel(); return () => clearTimeout(timer.current); }, [scope, active, cancel]);
  // A drag owns busy continuously; local handles move without publishing
  // intermediate model/map snapshots. Release uses the same scoped queue.
  const hold = useCallback(() => {
    if (!owner.current.active || owner.current.scope !== scope) return;
    clearTimeout(timer.current);
    timer.current = null;
    setPending(true);
  }, [scope]);
  const request = useCallback(work => {
    if (!owner.current.active || owner.current.scope !== scope) return;
    clearTimeout(timer.current);
    const expected = scope;
    setPending(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (owner.current.active && owner.current.scope === expected) {
        work();
        setPending(false);
      }
    }, RANGE_RECOMPUTE_DELAY_MS);
  }, [scope]);
  return { pending, request, hold, cancel };
}
