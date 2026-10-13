import { useCallback, useEffect, useRef, useState } from 'react';

export const RANGE_RECOMPUTE_DELAY_MS = 32;

// Publish busy first, then compute on a later turn. The latest request wins;
// leaving the date/subject/screen cancels work before it can publish a range.
// The delay starts once the busy render has committed (an effect), not when
// the request is made: a busy render slower than the delay (a long list, a
// slow phone or CI runner) let the work run, and busy clear, before the
// skeleton was ever committed.
export function useRangeRecompute(scope, active) {
  const [pending, setPending] = useState(false);
  // Each request is a new ticket; its work waits in `queued` for the commit.
  const [ticket, setTicket] = useState(0);
  const queued = useRef(null);
  const timer = useRef(null);
  const owner = useRef({ scope, active });
  owner.current = { scope, active };
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    queued.current = null;
    setPending(false);
  }, []);
  useEffect(() => { cancel(); return () => clearTimeout(timer.current); }, [scope, active, cancel]);
  // A drag owns busy continuously; local handles move without publishing
  // intermediate model/map snapshots. Release uses the same scoped queue.
  const hold = useCallback(() => {
    if (!owner.current.active || owner.current.scope !== scope) return;
    clearTimeout(timer.current);
    timer.current = null;
    queued.current = null;
    setPending(true);
  }, [scope]);
  const request = useCallback(work => {
    if (!owner.current.active || owner.current.scope !== scope) return;
    clearTimeout(timer.current);
    timer.current = null;
    queued.current = { work, scope };
    setPending(true);
    setTicket(value => value + 1);
  }, [scope]);
  // Committed with busy on screen: now wait the delay, then compute.
  useEffect(() => {
    const job = queued.current;
    if (!job) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (queued.current !== job) return;
      queued.current = null;
      if (owner.current.active && owner.current.scope === job.scope) {
        job.work();
        setPending(false);
      }
    }, RANGE_RECOMPUTE_DELAY_MS);
  }, [ticket]);
  return { pending, request, hold, cancel };
}
