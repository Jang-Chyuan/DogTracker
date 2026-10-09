import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

// When the system theme changes while the app is open, Android's System UI
// rebuilds its navigation bar: for ~300 ms (longer on a busy device) the
// window reports a bottom inset of 0, then the real one again. Passed through,
// every control placed above the navigation bar drops under it and jumps back
// (E04). A smaller bottom inset is therefore only taken once it has lasted;
// a larger one, and the other edges, are taken at once.
export const BOTTOM_DROP_MS = 1000;

export function StableInsets({ children }) {
  const insets = useSafeAreaInsets();
  const [bottom, setBottom] = useState(insets.bottom);
  useEffect(() => {
    if (insets.bottom >= bottom) {
      if (insets.bottom !== bottom) setBottom(insets.bottom);
      return undefined;
    }
    const timer = setTimeout(() => setBottom(insets.bottom), BOTTOM_DROP_MS);
    return () => clearTimeout(timer);
  }, [insets.bottom, bottom]);
  const shown = Math.max(bottom, insets.bottom);
  const value = useMemo(
    () => (shown === insets.bottom ? insets : { ...insets, bottom: shown }),
    [insets, shown],
  );
  return (
    <SafeAreaInsetsContext.Provider value={value}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}
