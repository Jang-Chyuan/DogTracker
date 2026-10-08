import { useEffect, useMemo, useState } from 'react';
import { Linking, LogBox } from 'react-native';
import { buildFixture, fixtureNameFromUrl, fixturePageFromUrl } from './ScreenFixtures';

// Debug builds only (__DEV__): listens for dogtracker://dev/fixture?name=…
// (&page=<a FIXTURE_PAGES name> opens that settings page of the state) and
// hands back the fixture to draw, or null for the live data (?name=off). Release builds never subscribe, and only the debug manifest
// (android/app/src/debug/AndroidManifest.xml) declares the scheme.
export function useScreenFixture(enabled = __DEV__) {
  const [name, setName] = useState(null);
  const [page, setPage] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const handle = url => {
      const next = fixtureNameFromUrl(url);
      if (next) {
        setName(next === 'off' ? null : next);
        setPage(next === 'off' ? null : fixturePageFromUrl(url));
      }
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
    console.log(`[ScreenFixture] showing ${name || 'off'}${page ? ` on ${page}` : ''}`);
  }, [enabled, name, page]);
  return useMemo(() => (enabled && name ? buildFixture(name, undefined, page) : null), [enabled, name, page]);
}

/**
 * In-memory names and faces for a fixture's dogs, changed on the dog's page
 * (A5), and its alert switches (S6), while the fixture is shown; forgotten when it changes or goes off.
 */
export function useFixtureEdits(fixture) {
  const [aliases, setAliases] = useState(null);
  const [avatars, setAvatars] = useState(null);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const name = fixture?.name ?? null;
  useEffect(() => {
    setAliases(null);
    setAvatars(null);
    setAlerts(null);
    setDiagnosticsEnabled(null);
  }, [name]);
  return useMemo(() => ({ aliases, avatars, alerts, diagnosticsEnabled, setDiagnosticsEnabled, setAliases, setAvatars, setAlerts }), [aliases, avatars, alerts, diagnosticsEnabled]);
}
