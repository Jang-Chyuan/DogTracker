import { useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { buildFixture, fixtureNameFromUrl } from './ScreenFixtures';

// Debug builds only (__DEV__): listens for dogtracker://dev/fixture?name=…
// and hands back the fixture to draw, or null for the live data. Release
// builds never subscribe, and only the debug manifest declares the scheme.
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
  return useMemo(() => (enabled && name ? buildFixture(name) : null), [enabled, name]);
}
