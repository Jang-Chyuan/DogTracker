import { useEffect, useMemo, useState } from 'react';
import { Linking, LogBox } from 'react-native';
import { buildFixture, fixtureNameFromUrl } from './ScreenFixtures';

// Debug builds only (__DEV__): listens for dogtracker://dev/fixture?name=…
// and hands back the fixture to draw, or null for the live data
// (?name=off). Release builds never subscribe, and only the debug manifest
// (android/app/src/debug/AndroidManifest.xml) declares the scheme.
export function useScreenFixture(enabled = __DEV__) {
  const [name, setName] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const handle = url => {
      const next = fixtureNameFromUrl(url);
      if (next) setName(next === 'off' ? null : next);
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const subscription = Linking.addEventListener('url', event => handle(event.url));
    return () => subscription.remove();
  }, [enabled]);
  // The yellow warning toast would land in every screenshot: hide it while a
  // fixture is shown (warnings still reach Metro and the debugger).
  useEffect(() => {
    if (!enabled) return;
    LogBox.ignoreAllLogs(!!name);
    // scripts/fixture-screenshots.sh waits for this line before its screenshot.
    console.log(`[ScreenFixture] showing ${name || 'off'}`);
  }, [enabled, name]);
  return useMemo(() => (enabled && name ? buildFixture(name) : null), [enabled, name]);
}
