import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { androidPermissions, askableIds, grantOf, neededPermissions, permissionsPage } from './Permissions';

const NO_NAMES = Object.freeze({});
const NO_IDS = Object.freeze([]);

/**
 * D2's permissions, asked for real: checks what this phone allows (again each
 * time the app comes back from the system settings), and 「全部允許」 sends
 * one system question after another — the next only once the one before
 * came back — updating each row as its answer arrives (D2a → D2b → D2c/D2d).
 *
 * `asked` are the questions sent before (TrackingPreferences.askedPermissions);
 * `onAsked(list)` saves the new list as each question is sent. `fixture`
 * ({ grants, asked }) draws a screen state
 * instead and asks nothing.
 */
export function usePermissionsGuide({ asked = NO_IDS, onAsked, fixture = null,
  version = Platform.Version, android = Platform.OS === 'android', permissions = PermissionsAndroid } = {}) {
  const needed = neededPermissions(android ? version : 99);
  const [grants, setGrants] = useState({});
  const [asking, setAsking] = useState(null);
  // Questions sent on this visit (saved too; kept here so the rows change
  // at once).
  const [askedNow, setAskedNow] = useState([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const names = permissions?.PERMISSIONS ?? NO_NAMES;

  const check = useCallback(async () => {
    if (!android) {
      setGrants(Object.fromEntries(needed.map(id => [id, 'granted'])));
      return;
    }
    const all = needed.flatMap(id => androidPermissions(id, names));
    const answers = await Promise.all(all.map(name => Promise.resolve()
      .then(() => permissions.check(name)).catch(() => false)));
    const granted = Object.fromEntries(all.map((name, index) => [name, !!answers[index]]));
    if (alive.current) setGrants(Object.fromEntries(needed.map(id => [id, grantOf(id, granted, names)])));
    // needed and names follow the Android version: fixed for the app's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [android, permissions]);

  useEffect(() => {
    if (fixture) return undefined;
    check();
    // Back from the system settings (or a 「僅允許這一次」 that ran out):
    // every row is checked again.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [check, fixture]);

  const running = useRef(false);
  const allowAll = useCallback(async () => {
    if (fixture || running.current) return;
    running.current = true;
    let sent = [...new Set([...asked, ...askedNow])];
    try {
      for (const id of askableIds({ needed, grants, asked: sent })) {
        if (!alive.current) return;
        sent = [...sent, id];
        setAskedNow(sent);
        Promise.resolve(onAsked?.(sent)).catch(() => {});
        setAsking(id);
        // A question closed with the back key counts as not allowed; the
        // next one is asked all the same.
        await Promise.resolve().then(() => permissions.requestMultiple(androidPermissions(id, names)))
          .catch(() => null);
        await check();
      }
    } finally {
      running.current = false;
      if (alive.current) setAsking(null);
    }
  }, [fixture, needed, grants, asked, askedNow, onAsked, permissions, names, check]);

  const page = permissionsPage({ needed, grants: fixture?.grants ?? grants,
    asked: fixture ? fixture.asked || [] : [...new Set([...asked, ...askedNow])], asking: fixture ? null : asking });
  return { ...page, allowAll, check };
}
