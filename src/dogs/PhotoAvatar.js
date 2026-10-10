import { t } from '../i18n';
import { getTheme } from '../theme/ThemeProvider';
import { size as sizes } from '../theme/tokens';
// A photo for a dog's face (design v3 A5c 拍照／相簿; DESIGN.md §12): taken
// with the camera or picked with the Android photo picker, then cropped to a
// circle and shrunk to a 512×512 JPEG. Only that small picture is kept (in
// dog_avatars, as a data URI); the camera's full-size shot and the picker's
// copies are deleted straight away, whatever happened.
import ImageCropPicker from 'react-native-image-crop-picker';

export const PHOTO_SIZE = sizes.avatar.photoSource;

// No compressImageQuality: with it the picker (0.52) writes the 256×256
// resize and then a second, recompressed copy, and only reports the second,
// so the first could never be deleted. The resize alone is a JPEG already.
// Square (width = height), round overlay, no free-style frame. The bottom
// aspect/rotate/scale bar is hidden: its labels are uCrop's own English
// strings, and a dog face only needs move and pinch.
export const CROP_OPTIONS = Object.freeze({
  width: PHOTO_SIZE, height: PHOTO_SIZE, cropping: true, cropperCircleOverlay: true,
  freeStyleCropEnabled: false, hideBottomControls: true, showCropGuidelines: false,
  includeBase64: true, mediaType: 'photo', forceJpg: true,
  cropperToolbarTitle: t("c649"),
  cropperChooseText: t("c648"), cropperCancelText: t('c046'),
});

// Color.parseColor takes #RRGGBB or #AARRGGBB only.
export function androidColor(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 || h.length === 4 ? [...h].map(c => c + c).join('') : h;
  if (full.length === 8) return `#${full.slice(6)}${full.slice(0, 6)}`.toUpperCase();
  return `#${full}`.toUpperCase();
}

// The crop screen (a native uCrop activity) follows the app theme: toolbar on
// the surface colour, title and buttons in text colour, coral for the active
// control, status bar icons dark in light mode and light in dark mode.
export function cropOptions(theme = getTheme()) {
  const c = theme.colors;
  return {
    ...CROP_OPTIONS,
    cropperToolbarColor: androidColor(c.surface),
    cropperToolbarWidgetColor: androidColor(c.text),
    cropperActiveWidgetColor: androidColor(c.accent),
    cropperStatusBarLight: !theme.isDark,
  };
}

const CANCELLED = 'E_PICKER_CANCELLED';
const NO_CAMERA = ['E_NO_CAMERA_PERMISSION', 'E_PERMISSION_MISSING'];

/**
 * @param source 'camera' (拍照) or 'library' (相簿)
 * @returns { avatar } with the cropped photo, { cancelled: true } when the
 *   user backed out (not an error), or { error: 'camera' | 'failed' }.
 */
export async function pickPhoto(source, picker = ImageCropPicker) {
  let original = null;
  let cropped = null;
  try {
    // Taken or picked first, cropped second, so the original's path is known
    // and it can be deleted.
    original = source === 'camera'
      ? await picker.openCamera({ mediaType: 'photo' })
      : await picker.openPicker({ mediaType: 'photo' });
    cropped = await picker.openCropper({ ...cropOptions(), path: original.path });
    if (!cropped?.data) return { error: 'failed' };
    return { avatar: { kind: 'photo', uri: `data:${cropped.mime || 'image/jpeg'};base64,${cropped.data}` } };
  } catch (error) {
    if (error?.code === CANCELLED) return { cancelled: true };
    if (NO_CAMERA.includes(error?.code)) return { error: 'camera' };
    return { error: 'failed' };
  } finally {
    for (const file of [original?.path, cropped?.path]) {
      if (file) await Promise.resolve(picker.cleanSingle?.(file)).catch(() => {});
    }
    await Promise.resolve(picker.clean?.()).catch(() => {});
  }
}

export const PHOTO_ERRORS = Object.freeze({
  camera: t("c647"),
  failed: t("c650"),
});
