import { useSyncExternalStore } from 'react';
import { Animated, NativeModules } from 'react-native';
import { markStartupPhase } from '../diagnostics/StartupPhases';

// The launch screen (D0, #47; 「D0 → 地圖銜接（C）」). The system launch
// screen shows first; as soon as JavaScript draws its exact copy
// (SplashOverlay), the system one goes (hideSplash) and the copy waits for
// the next screen: the map once it has framed its first view and placed its
// dogs, or a page of its own (D1 登入, onboarding, the D0 failure screen) once
// it is laid out. Then the copy hands over: 「狗跳到地圖上」 to the dog nearest
// the middle of the screen (opened from a notification: the alerted dog when
// it is on screen), or a plain fade. Until the start is decided the
// map's framing alone does not release it, so a first launch never shows the
// map for a moment before D1. Nothing black or blank ever shows in between:
// the copy covers the screen until the next one is drawn under it.
// `notification`: where the notification that opened the app leads
// (AlertNotifications.notificationDestination), once JavaScript has read it.
// `linkRead`: the launch link has been read (App: initialLinkRead); the map's
// handover waits for it, so it knows whether a notification opened the app.
const gate = { mapFramed: false, launch: null, targets: [], notification: null, linkRead: true, latestScope: null, latestSettled: true, gaveUp: false, capped: false };
let linkTimer = null;
let capTimer = null;

// The longest a signed-in cold start waits for this launch's latest positions
// (useInitialLatest), counted once from the first moment it waits: a new
// sync generation, publisher or retry does not start it again.
export const INITIAL_LATEST_WAIT_MS = 10000;
// Once that wait is over the map gets this long to frame what it has; then
// the copy hands over whatever is drawn (unframed, or still loading its
// tiles), with the map's own update hint, instead of holding the launch
// screen for the map's 15 s tile timeout or the 30 s hang safety net.
export const HANDOVER_GRACE_MS = 1500;
export const LAUNCH_HANDOVER_CAP_MS = INITIAL_LATEST_WAIT_MS + HANDOVER_GRACE_MS;
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

/** How this launch started (animations off); see AppSplash.kt. */
export function launchInfo() {
  try {
    return NativeModules.AppSplash?.launchInfo?.() ?? {};
  } catch {
    return {};
  }
}

// Notification destinations that stay on the live map; the others open a
// page over it, so the copy fades instead of flying to a covered map.
const MAP_DESTINATIONS = ['map', 'open-map'];

/**
 * The dogs to fly to, the alerted dog first when it is on screen (the others
 * nearest to it), else as framed: the dog nearest the middle first (判定表
 * 「從通知冷啟動」: 「狗飛到被提醒那隻（在畫面上時，不在就飛到最靠近中心的那隻）」).
 */
export function notificationTargets(targets, dogId) {
  const alerted = dogId == null ? null : targets.find(target => target.slaveId === dogId);
  if (!alerted) return targets;
  const distance = target => Math.hypot(target.x - alerted.x, target.y - alerted.y);
  return [alerted, ...targets.filter(target => target !== alerted).sort((a, b) => distance(a) - distance(b))];
}

function begin(mode, targets = []) {
  if (state.phase !== 'waiting') return;
  clearTimeout(capTimer);
  capTimer = null;
  const destination = gate.notification;
  // Opened from a notification that opens a page (or one not read yet while
  // the system says so): no map to land on.
  const pageFromNotification = destination
    ? !MAP_DESTINATIONS.includes(destination.screen)
    : false;
  const fly =
    mode === 'fly' &&
    targets.length > 0 &&
    !reducedMotion &&
    !pageFromNotification;
  if (fly) {
    splashChrome.setValue(0);
    targets = notificationTargets(targets, destination?.dogId ?? null);
  }
  markStartupPhase('splash-handover');
  setState({
    phase: 'handover',
    mode: fly ? 'fly' : 'fade',
    targets: fly ? targets : [],
    markersHidden: fly,
  });
}

function release() {
  if (gate.launch === 'page') begin('fade');
  else if (gate.launch === 'map' && gate.mapFramed && gate.linkRead && gate.latestSettled) begin('fly', gate.targets);
  // The launch's cap is over: what still holds the copy (the first framing,
  // the latest positions, the launch link) no longer does.
  else if (gate.launch === 'map' && gate.capped) begin('fade');
}

function armLaunchCap() {
  if (capTimer || gate.capped || state.phase !== 'waiting') return;
  capTimer = setTimeout(() => {
    capTimer = null;
    gate.capped = true;
    release();
  }, LAUNCH_HANDOVER_CAP_MS);
}

// Only the cold map needs this additional condition; page/guide launches
// retain their original escape. Scope is an opaque per-account/publisher token.
export function reportInitialLatest(scope, phase) {
  if (state.phase !== 'waiting') return;
  if (scope !== gate.latestScope) {
    gate.latestScope = scope;
    gate.mapFramed = false;
  }
  gate.latestSettled = ['bypass', 'accepted', 'fallback'].includes(phase);
  if (phase === 'waiting') armLaunchCap();
  if (phase === 'accepted' || phase === 'fallback') markStartupPhase('cloud-latest-settled');
  const latest = phase === 'bypass' ? null : { scope, phase };
  if (state.latest?.scope !== latest?.scope || state.latest?.phase !== latest?.phase)
    setState({ latest });
  // The hang safety net fired while latest was still inside its own bounded
  // wait: fade once that wait settles, exactly as the original escape would.
  if (gate.gaveUp && gate.latestSettled) begin('fade');
  else release();
}

// The longest the map's handover waits for the launch link.
export const LINK_WAIT_MS = 2000;

/**
 * App, as it starts reading the launch link (Linking.getInitialURL): the
 * map's handover waits until initialLinkRead, at most LINK_WAIT_MS.
 */
export function awaitInitialLink() {
  if (state.phase !== 'waiting') return;
  gate.linkRead = false;
  clearTimeout(linkTimer);
  linkTimer = setTimeout(initialLinkRead, LINK_WAIT_MS);
}

/** App: the launch link is read (a notification's, another, none or failed). */
export function initialLinkRead() {
  clearTimeout(linkTimer);
  linkTimer = null;
  if (gate.linkRead) return;
  gate.linkRead = true;
  release();
}

/**
 * GoogleTrackingMap: the live map has framed its first view and placed its
 * dogs. `targets`: the dogs on screen ({ slaveId, x, y, marker, tag, avatar },
 * screen points in dp), nearest to the middle first; none → a plain fade.
 */
export function reportMapFramed(targets = []) {
  if (state.phase === 'waiting') markStartupPhase('map-framed');
  gate.mapFramed = true;
  gate.targets = targets;
  release();
}

/**
 * App: this launch came from a notification tap leading to `destination`
 * ({ screen, dogId }). Called before the map is framed, the handover flies to
 * the alerted dog; to a page, it fades.
 */
export function launchFromNotification(destination) {
  if (state.phase !== 'waiting' || !destination) return;
  gate.notification = destination;
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

/**
 * SplashOverlay: the handover animation has started and lasts `durationMs`.
 * The native side switches the navigation bar to the app's colour when it
 * ends, without waiting for JavaScript (finishSplash can run late under load).
 */
export function handoverStarted(durationMs) {
  NativeModules.AppSplash?.handover?.(Math.max(0, Math.round(durationMs)));
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
  if (gate.latestScope && !gate.latestSettled) {
    // The latest hook has its own bounded fallback (accepted or 'fallback').
    // Only that added condition defers the escape; a map that never frames,
    // a launch never decided or an unread link still cannot hold the splash.
    gate.gaveUp = true;
    return;
  }
  begin('fade');
}

/** Tests only: a fresh start. */
export function resetSplashGate() {
  gate.mapFramed = false;
  gate.launch = null;
  gate.targets = [];
  gate.notification = null;
  gate.linkRead = true;
  gate.latestScope = null;
  gate.latestSettled = true;
  gate.gaveUp = false;
  gate.capped = false;
  clearTimeout(linkTimer);
  linkTimer = null;
  clearTimeout(capTimer);
  capTimer = null;
  splashChrome.setValue(1);
  reducedMotion = false;
  state = { phase: 'waiting', mode: null, targets: [], markersHidden: false };
}
