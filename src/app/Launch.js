// What the app opens on (design D0, 「初次使用」; 判定表「啟動與恢復登入」
// 「D1 的四種入口」). Pure: App hands in the database, the saved onboarding step
// and the sign-in restore; the launch screen (D0) stays while this says
// 'splash'.

// Restoring the sign-in waits this long under D0; after it the app opens on
// the map with this phone's own data and keeps retrying (S3 「暫時連不上，會
// 自動重試」).
export const RESTORE_TIMEOUT_MS = 10000;

// The first-launch guide, saved with the tracking preferences: the step the
// user is on — 'signIn' (D1), 'permissions' (D2), 'receiver' (D3, and D4 after
// it) — then 'done'. Each step is saved when the guide moves forward to it, so
// leaving the app midway (back key on D1, or closing it anywhere) continues
// at that step next time (「中途退出下次從中斷那步繼續」).
export const ONBOARDING_SIGN_IN = 'signIn';
export const ONBOARDING_PERMISSIONS = 'permissions';
export const ONBOARDING_RECEIVER = 'receiver';
export const ONBOARDING_DONE = 'done';
export const ONBOARDING_STEPS = [ONBOARDING_SIGN_IN, ONBOARDING_PERMISSIONS, ONBOARDING_RECEIVER, ONBOARDING_DONE];
// The guide's pages, by step: D1, D2, D3 (D4 opens from D3).
const GUIDE_PAGES = { [ONBOARDING_SIGN_IN]: 'signIn', [ONBOARDING_PERMISSIONS]: 'permissions',
  [ONBOARDING_RECEIVER]: 'pair' };

/**
 * input: { databaseReady, databaseError, preferencesSettled, onboarding,
 *   authSettled (the restore finished, or RESTORE_TIMEOUT_MS passed),
 *   signedIn, expiredAtStart (the restore found the sign-in refused) }.
 * Returns 'splash' | 'failed' (D0 資料打不開) | 'expired' (D1 with 需要重新
 * 登入) | 'onboarding' (the guide, at its saved step: guideStack) | 'map'.
 */
export function launchScreen(input) {
  if (input.databaseError && !input.databaseReady) return 'failed';
  if (!input.databaseReady || !input.preferencesSettled || !input.authSettled) return 'splash';
  if (input.expiredAtStart) return 'expired';
  // A restored session means the app was used before (an update from a
  // version without the guide): no D1 in front of the map.
  if (input.onboarding === ONBOARDING_SIGN_IN && !input.signedIn) return 'onboarding';
  // Past D1, the guide continues where it was left whether signed in or not.
  if (input.onboarding === ONBOARDING_PERMISSIONS || input.onboarding === ONBOARDING_RECEIVER) return 'onboarding';
  return 'map';
}

// Where D1 was opened from (the stack route's `entry`).
export const SIGN_IN_ENTRIES = ['onboarding', 'expired', 'cloud', 'map'];

/**
 * Leaving D1 by `how` ('done' signed in, 'later' 「稍後再說」, 'back' the back
 * key) from `entry`: { exit } closes the app (first launch, back: the next
 * start continues at D1), otherwise the page closes onto what is under it
 * (S3, or the map); { next } is the guide's next step (D2), opened instead.
 */
export function leaveSignIn(entry, how) {
  if (entry === 'onboarding') {
    if (how === 'back') return { exit: true, next: null };
    return { exit: false, next: ONBOARDING_PERMISSIONS };
  }
  return { exit: false, next: null };
}

/**
 * The guide's pages for a saved step, each over the one before it so the back
 * key walks back through the guide (D3 → D2 → D1 → leaves the app). D1 is
 * left out when the user is signed in (back from D2 then leaves the app too).
 */
export function guideStack(step, { signedIn = false } = {}) {
  const at = Math.max(0, ONBOARDING_STEPS.indexOf(step));
  const pages = ONBOARDING_STEPS.slice(0, at + 1).map(name => GUIDE_PAGES[name]).filter(Boolean)
    .filter(name => !(signedIn && name === 'signIn' && step !== ONBOARDING_SIGN_IN));
  return [{ name: 'map' }, ...pages.map(name => ({ name, entry: 'onboarding' }))];
}

/** The pages D1 sits on: the map, or S3 when 「登入」 was pressed there. */
export function signInStack(entry) {
  if (entry === 'cloud') {
    return [{ name: 'map' }, { name: 'settings' }, { name: 'cloud' }, { name: 'signIn', entry }];
  }
  return [{ name: 'map' }, { name: 'signIn', entry }];
}
