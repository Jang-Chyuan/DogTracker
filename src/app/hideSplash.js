import { useSyncExternalStore } from 'react';
import { Animated, NativeModules } from 'react-native';

// The launch screen (D0, #47; 「D0 → 地圖銜接（C）」). The system launch
// screen shows first; as soon as JavaScript draws its exact copy
// (SplashOverlay), the system one goes (hideSplash) and the copy waits for
// the next screen: the map once it has framed its first view and placed its
// dogs, or a page of its own (D1 登入, onboarding, the D0 failure screen) once
// it is laid out. Then the copy hands over: 「狗跳到地圖上」 to the dog nearest
// the middle of the screen, or a plain fade. Until the start is decided the
// map's framing alone does not release it, so a first launch never shows the
// map for a moment before D1. Nothing black or blank ever shows in between:
// the copy covers the screen until the next one is drawn under it.
const gate = { mapFramed: false, launch: null, targets: [] };
// 'waiting' (the copy covers the screen) → 'handover' (mode 'fly' | 'fade')
// → 'done'. The map's controls fade in through `chrome`; the real dog
// markers stay hidden while the copy draws them (markersHidden).
let state = { phase: 'waiting', mode: null, targets: [], markersHidden: false };
// Reduce motion (AccessibilityInfo, read by SplashOverlay at start): the
// handover is a plain crossfade, so the real markers and controls stay.
let reducedMotion = false;
const listeners = new Set();
export const splashChrome = new Animated.Value(1);

function setState(next) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener(state));
}

/** The launch screen copy's state, for SplashOverlay, the map and its controls. */
export const getSplashState = () => state;
export function subscribeSplash(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * JavaScript is running and deciding what opens first: the system launch
 * screen stays past the native 10 s safety timeout (up to 30 s) until the
 * copy is drawn.
 */
export function holdSplash() {
  NativeModules.AppSplash?.hold?.();
}

/** Lets the system launch screen go (the native module; a no-op without it). */
export function hideSplash() {
  NativeModules.AppSplash?.hide?.();
}

/** How this launch started (notification, animations off); see AppSplash.kt. */
export function launchInfo() {
  try {
    return NativeModules.AppSplash?.launchInfo?.() ?? {};
  } catch {
    return {};
  }
}

function begin(mode, targets = []) {
  if (state.phase !== 'waiting') return;
  const fly =
    mode === 'fly' &&
    targets.length > 0 &&
    !reducedMotion &&
    !launchInfo().fromNotification;
  if (fly) splashChrome.setValue(0);
  setState({
    phase: 'handover',
    mode: fly ? 'fly' : 'fade',
    targets: fly ? targets : [],
    markersHidden: fly,
  });
}

function release() {
  if (gate.launch === 'page') begin('fade');
  else if (gate.launch === 'map' && gate.mapFramed) begin('fly', gate.targets);
}

/**
 * GoogleTrackingMap: the live map has framed its first view and placed its
 * dogs. `targets`: the dogs on screen ({ slaveId, x, y, marker, tag, avatar },
 * screen points in dp), nearest to the middle first; none → a plain fade.
 */
export function reportMapFramed(targets = []) {
  gate.mapFramed = true;
  gate.targets = targets;
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

/** SplashOverlay: the real markers may show again (the copies are in place). */
export function showMarkers() {
  if (state.markersHidden) setState({ markersHidden: false });
}

/** SplashOverlay: the handover has finished; the copy is gone. */
export function finishSplash() {
  splashChrome.setValue(1);
  NativeModules.AppSplash?.done?.();
  setState({ phase: 'done', markersHidden: false, targets: [] });
}

/** For the map's dog markers: hidden while SplashOverlay draws their copies. */
export function useSplashMarkersHidden() {
  return useSplashState().markersHidden;
}

/** The launch screen copy's state, kept in step from the first render. */
export function useSplashState() {
  return useSyncExternalStore(subscribeSplash, getSplashState);
}

export function setReducedMotion(value) {
  reducedMotion = !!value;
}

/** Safety: nothing reported (a hang somewhere) — fade to whatever is there. */
export function giveUpWaiting() {
  begin('fade');
}

/** Tests only: a fresh start. */
export function resetSplashGate() {
  gate.mapFramed = false;
  gate.launch = null;
  gate.targets = [];
  splashChrome.setValue(1);
  reducedMotion = false;
  state = { phase: 'waiting', mode: null, targets: [], markersHidden: false };
}
