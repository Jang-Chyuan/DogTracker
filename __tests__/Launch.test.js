import { guideStack, launchScreen, leaveSignIn, signInStack, RESTORE_TIMEOUT_MS } from '../src/app/Launch';
import { buildFixture } from '../src/dev/ScreenFixtures';

const started = (changes = {}) => ({
  databaseReady: true, databaseError: null, preferencesSettled: true, onboarding: 'done',
  authSettled: true, signedIn: false, expiredAtStart: false, ...changes,
});

test('D0 stays until the database, the preferences and the sign-in restore are all in', () => {
  expect(RESTORE_TIMEOUT_MS).toBe(10000);
  expect(launchScreen(started({ databaseReady: false }))).toBe('splash');
  expect(launchScreen(started({ preferencesSettled: false }))).toBe('splash');
  expect(launchScreen(started({ authSettled: false }))).toBe('splash');
  expect(launchScreen(started())).toBe('map');
});

test('the database cannot be opened: the failure screen, whatever else is pending', () => {
  expect(launchScreen(started({ databaseReady: false, databaseError: 'SQLITE_CANTOPEN',
    preferencesSettled: false, authSettled: false }))).toBe('failed');
  // A read error after it opened is not a start failure.
  expect(launchScreen(started({ databaseError: 'locked' }))).toBe('map');
});

test('first launch → D1; signed in (an update) → the map; 登入失效 at the start → D1 again', () => {
  expect(launchScreen(started({ onboarding: 'signIn' }))).toBe('onboarding');
  expect(launchScreen(started({ onboarding: 'signIn', signedIn: true }))).toBe('map');
  expect(launchScreen(started({ expiredAtStart: true }))).toBe('expired');
});

test('the guide resumes where it was left (中途退出下次從中斷那步繼續), signed in or not', () => {
  for (const step of ['permissions', 'receiver', 'paired']) {
    expect(launchScreen(started({ onboarding: step }))).toBe('onboarding');
    expect(launchScreen(started({ onboarding: step, signedIn: true }))).toBe('onboarding');
  }
  const names = stack => stack.map(page => `${page.name}:${page.entry ?? ''}`);
  expect(names(guideStack('signIn'))).toEqual(['map:', 'signIn:onboarding']);
  // Each page over the one before: back walks D3 → D2 → D1.
  expect(names(guideStack('permissions'))).toEqual(['map:', 'signIn:onboarding', 'permissions:onboarding']);
  expect(names(guideStack('receiver'))).toEqual(['map:', 'signIn:onboarding', 'permissions:onboarding',
    'pair:onboarding']);
  expect(names(guideStack('paired')).at(-1)).toBe('paired:onboarding');
  // Signed in, D1 has nothing to show: not in the way back.
  expect(names(guideStack('receiver', { signedIn: true }))).toEqual(['map:', 'permissions:onboarding',
    'pair:onboarding']);
});

test('D1 four entries (判定表): where done, 稍後再說 and back lead', () => {
  // First launch: D2 next, back leaves the app.
  expect(leaveSignIn('onboarding', 'done')).toEqual({ exit: false, next: 'permissions' });
  expect(leaveSignIn('onboarding', 'later')).toEqual({ exit: false, next: 'permissions' });
  expect(leaveSignIn('onboarding', 'back')).toEqual({ exit: true, next: null });
  // Expired at the start, S3, A6: all three close D1 onto what is under it.
  for (const entry of ['expired', 'cloud', 'map']) {
    for (const how of ['done', 'later', 'back']) {
      expect(leaveSignIn(entry, how)).toEqual({ exit: false, next: null });
    }
  }
  expect(signInStack('cloud').map(page => page.name)).toEqual(['map', 'settings', 'cloud', 'signIn']);
  for (const entry of ['onboarding', 'expired', 'map']) {
    expect(signInStack(entry)).toEqual([{ name: 'map' }, { name: 'signIn', entry }]);
  }
});

test('start fixtures produce the start their names say', () => {
  const first = buildFixture('onboarding-first-launch');
  expect(launchScreen(first.launch)).toBe('onboarding');
  expect(first.cloudSync.ownerId).toBeFalsy();
  const slow = buildFixture('auth-restore-slow');
  expect(launchScreen(slow.launch)).toBe('map');
  expect(slow.launch.restoreTimedOut).toBe(true);
  expect(slow.restoring).toBe(true);
  // Signed out for now: only this phone's receiver (豆豆, dog 5).
  expect(slow.cloudDogs.rows).toEqual([]);
  const expired = buildFixture('auth-expired');
  expect(launchScreen(expired.launch)).toBe('expired');
  expect(expired.expired).toBe(true);
  const failed = buildFixture('db-open-failed');
  expect(launchScreen(failed.launch)).toBe('failed');
  expect(failed.launch.databaseError).toMatch(/SQLITE_CANTOPEN/);
  // Other fixtures leave the start alone.
  expect(buildFixture('all-good').launch).toBeNull();
});
