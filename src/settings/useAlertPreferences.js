import { useEffect, useRef, useState } from 'react';
import { changeAlertPreferences, normalizeAlertPreferences } from '../alerts/AlertPreferences';

const same = (left, right) => Object.keys(left).every(key => left[key] === right[key]);

/**
 * 設定 → 提醒's switches over the saved tracking preferences: a change shows
 * at once and is saved at once (design 「改了立刻存」); if the save fails,
 * the switches go back to what is saved. `saved` is the stored `alerts`
 * value, `save(patch)` the tracking preferences' save (true = saved; anything
 * else, e.g. false while the preferences are not loaded, = not saved).
 */
export function useAlertPreferences(saved, save) {
  const stored = normalizeAlertPreferences(saved);
  const [pending, setPending] = useState(null);
  const current = useRef(stored);
  current.current = pending ?? stored;
  const request = useRef(0);
  // Once the saved value has caught up, it is the one shown.
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    setPending(value => (value && same(value, JSON.parse(storedKey)) ? null : value));
  }, [storedKey]);
  const change = patch => {
    const next = changeAlertPreferences(current.current, patch);
    current.current = next;
    setPending(next);
    const id = ++request.current;
    const failed = () => { if (id === request.current) setPending(null); };
    Promise.resolve().then(() => save?.({ alerts: next }))
      .then(ok => { if (ok !== true) failed(); }, failed);
  };
  return { value: current.current, change };
}
