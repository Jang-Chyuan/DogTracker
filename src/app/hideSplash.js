import { NativeModules } from 'react-native';

// The launch screen (D0, #47) covers opening the database and restoring the
// sign-in. It goes once the app knows what to show first and that screen is
// ready: the map after its first framing, or a page of its own (D1 登入, the
// D0 failure screen) once it is laid out. Until the start is decided, the
// map's framing alone does not release it, so a first launch never shows the
// map for a moment before D1. MainActivity's own timeout still lets the app
// through if neither ever reports.
const gate = { mapFramed: false, launch: null };

/** Lets the launch screen go (the native module; a no-op without it). */
export function hideSplash() {
  NativeModules.AppSplash?.hide?.();
}

function release() {
  if (gate.launch === 'page' || (gate.launch === 'map' && gate.mapFramed)) hideSplash();
}

/** GoogleTrackingMap: the live map has framed its first view. */
export function reportMapFramed() {
  gate.mapFramed = true;
  release();
}

/**
 * The start is decided: 'map' waits for the map's first framing, 'page' (D1,
 * the D0 failure screen) releases now — call it once that page is laid out.
 */
export function launchInto(screen) {
  gate.launch = screen;
  release();
}

/** Tests only: a fresh start. */
export function resetSplashGate() {
  gate.mapFramed = false;
  gate.launch = null;
}
