// TalkBack focus on sheets (設計稿「無障礙」, 焦點順序): when a sheet or a
// dialog opens, TalkBack starts on its title, not wherever it was behind it;
// the screen behind is hidden from TalkBack while it is open
// (importantForAccessibility, since Android ignores accessibilityViewIsModal).
import { useEffect } from 'react';
import { AccessibilityInfo, findNodeHandle } from 'react-native';

// After the sheet's first layout (its rise has started).
const FOCUS_DELAY_MS = 120;

/** Moves TalkBack's focus to `ref` once `ready` (no-op without TalkBack). */
export function focusOn(ref) {
  const handle = ref?.current ? findNodeHandle(ref.current) : null;
  if (handle) AccessibilityInfo.setAccessibilityFocus?.(handle);
}

export function useInitialFocus(ref, ready = true) {
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => focusOn(ref), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ref, ready]);
}

/** importantForAccessibility for what lies behind an open sheet. */
export const behindSheet = open => (open ? 'no-hide-descendants' : 'auto');
