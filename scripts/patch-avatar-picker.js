// react-native-image-crop-picker 0.52.0 uses PickVisualMedia (with a system
// document picker fallback). Camera output is in getExternalFilesDir through
// FileProvider. Neither path needs broad storage permission, even on API <=29.
const fs = require('fs');
const path = require('path');
const root = path.dirname(require.resolve('react-native-image-crop-picker/package.json'));
const file = path.join(root, 'android/src/main/java/com/reactnative/ivpusic/imagepicker/ImageCropPicker.java');
const original = fs.readFileSync(file, 'utf8');
const old = `        // android 11 introduced scoped storage, and WRITE_EXTERNAL_STORAGE no longer works there
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.Q) {
            supportedPermissions.remove(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }`;
const replacement = `        // DogTracker: system picker and app-owned FileProvider output need no storage permission.
        supportedPermissions.remove(Manifest.permission.WRITE_EXTERNAL_STORAGE);`;
if (!original.includes(replacement)) {
  if (!original.includes(old)) {
    throw new Error('Avatar picker permission patch needs review after dependency update');
  }
  fs.writeFileSync(file, original.replace(old, replacement));
}
