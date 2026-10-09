import { useEffect, useRef, useState } from 'react';
import { changeAlertPreferences, normalizeAlertPreferences } from '../alerts/AlertPreferences';

const same = (left, right) => Object.keys(left).every(key => left[key] === right[key]);

/**
 * 設定 → 提醒's switches over the saved tracking preferences: a change shows
 * at once and is saved at once (design 「改了立刻存」); if the save fails,
 * the switches go back to what is saved. `saved` is the stored `alerts`
 * value, `save(patch)` the tracking preferences' save, which publishes the
 * stored value before it resolves; `source` names where `saved` comes from
 * (live or a fixture).
 */
export function useAlertPreferences(saved, save, source = null) {
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
  // Live data and a fixture (or two fixtures) never share a change in flight.
  useEffect(() => {
    request.current += 1;
    setPending(null);
  }, [source]);
  const change = patch => {
    const next = changeAlertPreferences(current.current, patch);
    current.current = next;
    setPending(next);
    const id = ++request.current;
    // When the newest change has been written (or refused), what is stored
    // is the answer: the saved value has already reached `saved`, a refused
    // one leaves it as it was. Older writes settling change nothing.
    const settled = () => { if (id === request.current) setPending(null); };
    Promise.resolve().then(() => save?.({ alerts: next })).then(settled, settled);
  };
  return { value: current.current, change };
}
