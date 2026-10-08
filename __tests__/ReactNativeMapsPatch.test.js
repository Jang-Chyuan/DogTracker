// 「地圖上永遠不出現 Google 預設紅色圖釘」: react-native-maps (Android, Fabric)
// removes a marker's own view before the marker itself, and a marker can be
// added before its view arrives; in both gaps the SDK would draw its default
// red pin. patches/react-native-maps+<version>.patch keeps such a marker
// hidden instead (DOGTRACKER_NO_DEFAULT_PIN). This checks that the patch is
// there, matches the installed version, runs on every install, and has been
// applied to the Java source the Android build compiles.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const MARK = 'DOGTRACKER_NO_DEFAULT_PIN';
const mapsPackage = require('react-native-maps/package.json');
const patchFile = path.join(
  root,
  'patches',
  `react-native-maps+${mapsPackage.version}.patch`,
);
const markerSource = path.join(
  path.dirname(require.resolve('react-native-maps/package.json')),
  'android/src/main/java/com/rnmaps/maps/MapMarker.java',
);

test('the react-native-maps patch exists for the installed version', () => {
  const patch = fs.readFileSync(patchFile, 'utf8');
  expect(patch).toContain(MARK);
  expect(patch).toContain('android/src/main/java/com/rnmaps/maps/MapMarker.java');
  // Only the Java source: no build outputs in the patch.
  expect(patch).not.toMatch(/^diff --git .*\/build\//m);
});

test('every npm install applies the patch', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts.postinstall).toBe('patch-package');
  expect(pkg.devDependencies['patch-package']).toBeTruthy();
});

test('the installed MapMarker.java is patched: a marker without its own icon is hidden, never the default pin', () => {
  const source = fs.readFileSync(markerSource, 'utf8');
  expect(source).toContain(MARK);
  // New markers start hidden until their view arrives …
  expect(source).toMatch(/options\.visible\(hasOwnIcon\(\)\);/);
  // … and a marker that loses its view is hidden instead of re-iconed.
  const update = source.slice(
    source.indexOf('public void updateMarkerIcon()'),
    source.indexOf('public LatLng interpolate'),
  );
  expect(update).toMatch(/if \(!hasOwnIcon\(\)\) \{\s*if \(marker\.isVisible\(\)\) marker\.setVisible\(false\);\s*return;/);
  expect(update.indexOf('marker.setIcon(getIcon())')).toBeLessThan(
    update.indexOf('marker.setVisible(true)'),
  );
});
