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
const javaRoot = path.join(
  path.dirname(require.resolve('react-native-maps/package.json')),
  'android/src/main/java/com/rnmaps',
);
const markerSource = path.join(javaRoot, 'maps/MapMarker.java');
const mapViewManagerSource = path.join(javaRoot, 'fabric/MapViewManager.java');

test('the react-native-maps patch exists for the installed version', () => {
  const patch = fs.readFileSync(patchFile, 'utf8');
  expect(patch).toContain(MARK);
  expect(patch).toContain('android/src/main/java/com/rnmaps/maps/MapMarker.java');
  expect(patch).toContain('android/src/main/java/com/rnmaps/fabric/MapViewManager.java');
  // Only the Java source: no build outputs in the patch.
  expect(patch).not.toMatch(/^diff --git .*\/build\//m);
});

test('every npm install applies the patch', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  // --error-on-fail: a patch that no longer applies fails the install
  // everywhere, not only in CI.
  expect(pkg.scripts.postinstall).toBe('patch-package --error-on-fail');
  expect(pkg.devDependencies['patch-package']).toBeTruthy();
});

test('the installed MapMarker.java is patched: a marker without its own icon is hidden, never the default pin', () => {
  const source = fs.readFileSync(markerSource, 'utf8');
  expect(source).toContain(MARK);
  // Its own icon = a view of its own or an image; nothing else.
  expect(source).toMatch(
    /private boolean hasOwnIcon\(\) \{\s*return hasCustomMarkerView \|\| iconBitmapDescriptor != null;\s*\}/,
  );
  // New markers start hidden until their view arrives …
  expect(source).toMatch(/options\.visible\(hasOwnIcon\(\)\);/);
  // … and a marker that loses its view is hidden instead of re-iconed.
  const update = source.slice(
    source.indexOf('public void updateMarkerIcon()'),
    source.indexOf('public LatLng interpolate'),
  );
  expect(update).toMatch(/if \(!hasOwnIcon\(\)\) \{\s*if \(marker\.isVisible\(\)\) marker\.setVisible\(false\);\s*return;/);
  // Shown only after it has been given its own icon.
  const setIcon = update.indexOf('marker.setIcon(getIcon())');
  const show = update.indexOf('marker.setVisible(true)');
  expect(setIcon).toBeGreaterThan(-1);
  expect(show).toBeGreaterThan(setIcon);
});

test('the image-load callback no longer shows a marker by itself', () => {
  const source = fs.readFileSync(mapViewManagerSource, 'utf8');
  expect(source).toContain(MARK);
  expect(source).not.toMatch(/setVisible\(true\)/);
});

// E02 and the history memory leak: removing a feature from the map also
// detaches a marker's view from any old attacher group
// (DOGTRACKER_MARKER_PARENT) and empties every lookup map addFeature filled
// (DOGTRACKER_FEATURE_MAPS); upstream kept each removed line, area and overlay.
test('the installed MapView.java removes features completely', () => {
  const source = fs.readFileSync(path.join(javaRoot, 'maps/MapView.java'), 'utf8');
  const remove = source.slice(
    source.indexOf('public void removeFeatureAt(int index)'),
    source.indexOf('public void removeFeatureAt(int index)') + 3000,
  );
  expect(remove).toContain('DOGTRACKER_MARKER_PARENT');
  expect(remove).toMatch(/safeRemoveFromParent\(feature\);/);
  expect(remove).toContain('DOGTRACKER_FEATURE_MAPS');
  for (const lookup of ['markerMap', 'heatmapMap', 'overlayMap', 'polygonMap', 'polylineMap', 'gradientPolylineMap'])
    expect(remove).toContain(`${lookup}.remove(feature.getFeature());`);
});

// One GoogleMap per MapView (DOGTRACKER_KEEP_MAP): a re-attached MapView is
// started again, never re-created, and keeps its features, so nothing can be
// lost or left behind on the map (a leak per re-attach, a receiver ring on a
// history map).
test('the installed MapView.java never re-creates its map on re-attach', () => {
  const source = fs.readFileSync(path.join(javaRoot, 'maps/MapView.java'), 'utf8');
  expect(source).toContain('DOGTRACKER_KEEP_MAP');
  expect(source).toMatch(/public void onCreate\(LifecycleOwner owner\) \{\s*if \(mapCreated\) return;\s*mapCreated = true;\s*super\.onCreate\(null\);/);
  const attach = source.slice(source.indexOf('protected void onAttachedToWindow()'), source.indexOf('protected void onDetachedFromWindow()'));
  expect(attach).not.toMatch(/onCreate\(/);
  expect(attach).not.toContain('savedFeatures');
  const detach = source.slice(source.indexOf('protected void onDetachedFromWindow()'), source.indexOf('private void attachLifecycleObserver()'));
  expect(detach).not.toContain('savedFeatures = new ArrayList');
  expect(detach).not.toContain('features.clear()');
  expect(detach).not.toContain('removeView(attacherGroup)');
});

// S-media: the avatar picker asks for no storage permission (system photo
// picker, camera output through the app's FileProvider); the change lives in
// patches/react-native-image-crop-picker+<version>.patch, applied by the same
// patch-package postinstall.
test('the installed avatar picker never requests WRITE_EXTERNAL_STORAGE', () => {
  const pickerPackage = require('react-native-image-crop-picker/package.json');
  const patch = fs.readFileSync(
    path.join(root, 'patches', `react-native-image-crop-picker+${pickerPackage.version}.patch`),
    'utf8',
  );
  expect(patch).not.toMatch(/^diff --git .*\/build\//m);
  const source = fs.readFileSync(
    path.join(
      path.dirname(require.resolve('react-native-image-crop-picker/package.json')),
      'android/src/main/java/com/reactnative/ivpusic/imagepicker/ImageCropPicker.java',
    ),
    'utf8',
  );
  expect(source).toMatch(
    /DogTracker: system picker[^\n]*\n\s*supportedPermissions\.remove\(Manifest\.permission\.WRITE_EXTERNAL_STORAGE\);/,
  );
});
