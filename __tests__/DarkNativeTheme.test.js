import fs from 'fs';
import path from 'path';
import spec from '../src/theme/dark-tokens.json';
const android = path.join(__dirname, '..', 'android/app/src/main');
const read = file => fs.readFileSync(path.join(android, file), 'utf8');
test('night colours match the design, including elevated native dialogs and splash', () => {
  const xml = read('res/values-night/colors.xml');
  for (const [name, value] of Object.entries(
    spec.android['values-night/colors.xml'],
  )) {
    expect(xml).toContain(`<color name="${name}">${value}</color>`);
  }
  expect(xml).toContain(
    `<color name="dialog_surface">${spec.android.AppAlertDialog.background}</color>`,
  );
  expect(read('res/drawable/dialog_background.xml')).toContain(
    '@color/dialog_surface',
  );
  // 1dp floatingOutline edge in dark only.
  expect(xml).toContain(
    `<color name="dialog_outline">${spec.darkOnly.floatingOutline}</color>`,
  );
  expect(read('res/values-night/dimens.xml')).toContain('>1dp</dimen>');
  expect(read('res/values/dimens.xml')).toContain('>0dp</dimen>');
  const styles = read('res/values-night/styles.xml');
  for (const name of [
    'colorAccent',
    'textColorPrimary',
    'textColorSecondary',
  ]) {
    expect(styles).toContain(`>${spec.android.AppAlertDialog[name]}</item>`);
  }
  expect(styles).toContain('Theme.AppCompat.DayNight.NoActionBar');
  expect(styles).toContain('Theme.AppCompat.DayNight.Dialog.Alert');
  expect(styles).toContain('android:windowLightStatusBar">false');
  expect(styles).toContain('android:windowLightNavigationBar">false');
  expect(styles).toContain('android:forceDarkAllowed">false');
  expect(read('res/values-night-v31/styles.xml')).toContain(
    'windowSplashScreenIconBackgroundColor',
  );
});
test('native system bars update on a live configuration change', () => {
  const activity = read('java/com/dogtracker/MainActivity.kt');
  expect(activity).toContain('override fun onConfigurationChanged');
  expect(activity).toContain('isAppearanceLightStatusBars = !dark');
  expect(activity).toContain('isAppearanceLightNavigationBars = !dark');
  expect(activity).not.toContain('MODE_NIGHT_NO');
});
