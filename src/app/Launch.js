// What the app opens on (design D0, 「初次使用」; 判定表「啟動與恢復登入」
// 「D1 的四種入口」). Pure: App hands in the database, the saved onboarding step
// and the sign-in restore; the launch screen (D0) stays while this says
// 'splash'.

// Restoring the sign-in waits this long under D0; after it the app opens on
// the map with this phone's own data and keeps retrying (S3 「暫時連不上，會
// 自動重試」).
export const RESTORE_TIMEOUT_MS = 10000;

// The first-launch guide, saved with the tracking preferences: 'signIn' until
// D1 is passed (「稍後再說」 or signed in), then 'done'. Leaving the app on D1
// (back key) keeps 'signIn', so the next start continues there. D2–D4 (053)
// add their own steps between.
export const ONBOARDING_SIGN_IN = 'signIn';
export const ONBOARDING_DONE = 'done';

/**
 * input: { databaseReady, databaseError, preferencesSettled, onboarding,
 *   authSettled (the restore finished, or RESTORE_TIMEOUT_MS passed),
 *   signedIn, expiredAtStart (the restore found the sign-in refused) }.
 * Returns 'splash' | 'failed' (D0 資料打不開) | 'expired' (D1 with 需要重新
 * 登入) | 'onboarding' (D1, first launch) | 'map'.
 */
export function launchScreen(input) {
  if (input.databaseError && !input.databaseReady) return 'failed';
  if (!input.databaseReady || !input.preferencesSettled || !input.authSettled) return 'splash';
  if (input.expiredAtStart) return 'expired';
  // A restored session means the app was used before (an update from a
  // version without the guide): no D1 in front of the map.
  if (input.onboarding === ONBOARDING_SIGN_IN && !input.signedIn) return 'onboarding';
  return 'map';
}

// Where D1 was opened from (the stack route's `entry`).
export const SIGN_IN_ENTRIES = ['onboarding', 'expired', 'cloud', 'map'];

/**
 * Leaving D1 by `how` ('done' signed in, 'later' 「稍後再說」, 'back' the back
 * key) from `entry`: { exit } closes the app (first launch, back: the next
 * start continues at D1), otherwise the page closes onto what is under it
 * (S3, or the map); { finishOnboarding } saves the guide as passed.
 */
export function leaveSignIn(entry, how) {
  if (entry === 'onboarding') {
    if (how === 'back') return { exit: true, finishOnboarding: false };
    // D2 (053) comes next; until then the guide ends on the map.
    return { exit: false, finishOnboarding: true };
  }
  return { exit: false, finishOnboarding: false };
}

/** The pages D1 sits on: the map, or S3 when 「登入」 was pressed there. */
export function signInStack(entry) {
  if (entry === 'cloud') {
    return [{ name: 'map' }, { name: 'settings' }, { name: 'cloud' }, { name: 'signIn', entry }];
  }
  return [{ name: 'map' }, { name: 'signIn', entry }];
}
