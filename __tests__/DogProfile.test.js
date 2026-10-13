import { t as i18nT } from '../src/i18n';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, Keyboard, ScrollView, TextInput } from 'react-native';
import DogProfile from '../src/dogs/DogProfile';
import AvatarPicker, { NEUTRAL_TINT } from '../src/dogs/AvatarPicker';
import ConfirmDialog from '../src/settings/ConfirmDialog';
import DogAvatar from '../src/dogs/DogAvatar';
import { NAME_MAX, clampName, displayName, nameLength, nameToSave } from '../src/dogs/DogName';
import { CROP_OPTIONS, PHOTO_SIZE, androidColor, cropOptions, pickPhoto } from '../src/dogs/PhotoAvatar';
import { darkTheme, lightTheme } from '../src/theme/ThemeProvider';
import { DOG_ART_KEYS, DOG_COLOR_KEYS, DOG_COLORS } from '../src/dogs/DogArt';
import { colors } from '../src/theme/tokens';

// ---- the name (A5a rules) ---------------------------------------------------

test('a name is at most 20 characters, counted as the user sees them', () => {
  expect(NAME_MAX).toBe(20);
  expect(clampName('一二三四五六七八九十一二三四五六七八九十一二')).toBe('一二三四五六七八九十一二三四五六七八九十');
  // An emoji is one character and is never cut in half.
  const dogs = '🐶'.repeat(21);
  expect(nameLength(clampName(dogs))).toBe(20);
  expect(clampName(dogs)).toBe('🐶'.repeat(20));
  expect(nameLength('小黑')).toBe(2);
});

test('finishing an edit stores a trimmed new name; empty, spaces or unchanged store nothing', () => {
  expect(nameToSave('  小白 ', '小黑')).toBe('小白');
  expect(nameToSave('', '小黑')).toBeNull();
  expect(nameToSave('   ', '小黑')).toBeNull();
  expect(nameToSave('小黑', '小黑')).toBeNull();
  expect(nameToSave('', '')).toBeNull();
  expect(nameToSave('豆豆', '')).toBe('豆豆');
});

test('a dog nobody named is 「狗 4」', () => {
  expect(displayName(4, {})).toBe('狗 4');
  expect(displayName(4, { 4: ' 豆豆 ' })).toBe('豆豆');
  expect(displayName(4, null)).toBe('狗 4');
});

// ---- the photo (512×512, nothing else kept) ---------------------------------

const stubPicker = (overrides = {}) => ({
  openCamera: jest.fn(async () => ({ path: 'file:///pictures/shot.jpg' })),
  openPicker: jest.fn(async () => ({ path: 'file:///cache/picked.jpg' })),
  openCropper: jest.fn(async () => ({ path: 'file:///cache/cropped.jpg', data: 'AAAA', mime: 'image/jpeg' })),
  cleanSingle: jest.fn(async () => {}),
  clean: jest.fn(async () => {}),
  ...overrides,
});

test('crop screen: square round crop, same for camera and library, themed light and dark', async () => {
  const camera = stubPicker();
  const library = stubPicker();
  await pickPhoto('camera', camera);
  await pickPhoto('library', library);
  const strip = ({ path, ...rest }) => rest;
  expect(strip(camera.openCropper.mock.calls[0][0])).toEqual(strip(library.openCropper.mock.calls[0][0]));
  expect(CROP_OPTIONS).toMatchObject({ cropping: true, cropperCircleOverlay: true, width: PHOTO_SIZE, height: PHOTO_SIZE });
  expect(CROP_OPTIONS.cropperToolbarTitle).toBe(i18nT('c649'));
  expect(CROP_OPTIONS.cropperCancelText).toBe(i18nT('c046'));
  const light = cropOptions(lightTheme);
  const dark = cropOptions(darkTheme);
  expect(light).toMatchObject({ cropperToolbarColor: androidColor(lightTheme.colors.surface),
    cropperToolbarWidgetColor: androidColor(lightTheme.colors.text), cropperStatusBarLight: true });
  expect(dark).toMatchObject({ cropperToolbarColor: androidColor(darkTheme.colors.surface),
    cropperToolbarWidgetColor: androidColor(darkTheme.colors.text), cropperStatusBarLight: false });
  for (const o of [light, dark]) {
    for (const k of ['cropperToolbarColor', 'cropperToolbarWidgetColor', 'cropperActiveWidgetColor']) {
      expect(o[k]).toMatch(/^#([0-9A-F]{6}|[0-9A-F]{8})$/);
    }
  }
  expect(androidColor('#fa0')).toBe('#FFAA00');
  expect(androidColor('#0009')).toBe('#99000000');
  expect(androidColor('#11223344')).toBe('#44112233');
});

test('拍照: taken, cropped round to 512×512, and every file it made deleted', async () => {
  const picker = stubPicker();
  expect(await pickPhoto('camera', picker)).toEqual({ avatar: { kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' } });
  expect(picker.openCamera).toHaveBeenCalledWith({ mediaType: 'photo' });
  expect(picker.openPicker).not.toHaveBeenCalled();
  expect(picker.openCropper).toHaveBeenCalledWith(expect.objectContaining({ path: 'file:///pictures/shot.jpg',
    width: 512, height: 512, cropperCircleOverlay: true, hideBottomControls: true, freeStyleCropEnabled: false, includeBase64: true, forceJpg: true }));
  expect(PHOTO_SIZE).toBe(512);
  expect(CROP_OPTIONS.cropperChooseText).toBe(i18nT("c648"));
  // Recompressing would leave the picker's first resized copy behind.
  expect(CROP_OPTIONS.compressImageQuality).toBeUndefined();
  expect(picker.cleanSingle).toHaveBeenCalledWith('file:///pictures/shot.jpg');
  expect(picker.cleanSingle).toHaveBeenCalledWith('file:///cache/cropped.jpg');
  expect(picker.clean).toHaveBeenCalled();
});

test('相簿 uses the photo picker; backing out is not an error and still cleans up', async () => {
  const cancelled = Object.assign(new Error('cancel'), { code: 'E_PICKER_CANCELLED' });
  const picker = stubPicker({ openCropper: jest.fn(async () => { throw cancelled; }) });
  expect(await pickPhoto('library', picker)).toEqual({ cancelled: true });
  expect(picker.openPicker).toHaveBeenCalledWith({ mediaType: 'photo' });
  expect(picker.cleanSingle).toHaveBeenCalledWith('file:///cache/picked.jpg');
  expect(picker.clean).toHaveBeenCalled();
});

test('no camera permission and other failures are told apart', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'E_NO_CAMERA_PERMISSION' });
  expect(await pickPhoto('camera', stubPicker({ openCamera: jest.fn(async () => { throw denied; }) })))
    .toEqual({ error: 'camera' });
  expect(await pickPhoto('camera', stubPicker({ openCropper: jest.fn(async () => ({ path: 'x' })) })))
    .toEqual({ error: 'failed' });
  // A failing clean-up never hides the photo.
  const picker = stubPicker({ cleanSingle: jest.fn(async () => { throw new Error('gone'); }) });
  expect((await pickPhoto('library', picker)).avatar.kind).toBe('photo');
});

// ---- the edit sheet (A5: name and face in one sheet) ------------------------

let renderer, backHandlers, keyboardListeners;
beforeEach(() => {
  jest.useFakeTimers();
  backHandlers = [];
  keyboardListeners = {};
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    backHandlers.push(callback);
    return { remove: () => { backHandlers = backHandlers.filter(item => item !== callback); } };
  });
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    keyboardListeners[name] = callback;
    return { remove: () => { delete keyboardListeners[name]; } };
  });
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// The Android back key: the newest listener first, until one returns true.
const pressBack = async () => {
  await act(async () => {
    for (const handler of [...backHandlers].reverse()) if (handler()) break;
  });
};
const flatten = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  return flatten(node.children);
};
const byTestId = id => renderer.root.findAll(node => node.props.testID === id && typeof node.type !== 'string');
const hostCount = id => renderer.root.findAll(node => node.props.testID === id && typeof node.type === 'string').length;
const press = async id => act(async () => byTestId(id)[0].props.onPress());
const input = () => renderer.root.findAllByType(TextInput)[0];
const type = async value => act(async () => input().props.onChangeText(value));
const settle = async () => act(async () => { jest.runAllTimers(); });
const sheet = () => byTestId('dog-profile-sheet')[0];
const sheetStyle = () => Object.assign({}, ...[sheet().props.style].flat(3).filter(Boolean));
const discardOpen = () => renderer.root.findByType(ConfirmDialog).props.visible;
const previewFace = () => renderer.root.findByType(AvatarPicker).findAllByType(DogAvatar)[0].props.avatar;

async function mount(props = {}) {
  const handlers = { onSaveName: jest.fn(async () => true), onSaveAvatar: jest.fn(async () => true), onBack: jest.fn() };
  await act(async () => {
    renderer = Renderer.create(<DogProfile slaveId={4} name="豆豆" alias="豆豆" avatar={null} picker={stubPicker()}
      {...handlers} {...props} />);
  });
  await act(async () => sheet().props.onLayout({ nativeEvent: { layout: { height: 640 } } }));
  await settle();
  return handlers;
}
// The parent stores what the sheet saved and hands it back as props.
const rerender = async props => act(async () => {
  renderer.update(<DogProfile {...renderer.root.findByType(DogProfile).props} {...props} />);
});

test('A5: one sheet — 取消 名字和頭像 完成, the name input, 訊號源 4 read only, then the face picker', async () => {
  await mount({ avatar: { kind: 'art', art: 'prick', color: 'blue' } });
  const text = flatten(renderer.toJSON());
  expect(text).toContain(`${i18nT('c046')}${i18nT('c1330')}${i18nT('c101')}`);
  // Name first, the face below it.
  expect(text).toContain(`${i18nT('c1331')}訊號源 4${i18nT('c100')}拍照相簿插圖樣子底色`);
  expect(input().props.value).toBe('豆豆');
  expect(input().props.placeholder).toBe(i18nT('c347'));
  expect(input().props.accessibilityLabel).toBe(i18nT('c347'));
  expect(input().props.returnKeyType).toBe('done');
  // The keyboard does not come up on its own: changing only the face needs none.
  expect(input().props.autoFocus).toBeFalsy();
  // 訊號源 is text, not a control.
  expect(byTestId('dog-profile-source')[0].props.onPress).toBeUndefined();
  // No separate A5c step: the picker is part of the sheet from the start.
  expect(renderer.root.findAllByType(AvatarPicker)).toHaveLength(1);
  expect(DOG_ART_KEYS.map(key => hostCount(`avatar-art-${key}`))).toEqual([1, 1, 1, 1, 1]);
  expect(DOG_COLOR_KEYS).toHaveLength(12);
  expect(DOG_COLOR_KEYS.every(key => hostCount(`avatar-color-${key}`) === 1)).toBe(true);
  // The stored face is chosen: 插圖 highlighted, its drawing and colour selected.
  expect(byTestId('avatar-source-插圖')[0].props.accessibilityState.selected).toBe(true);
  expect(byTestId('avatar-art-prick')[0].props.accessibilityState.selected).toBe(true);
  expect(byTestId('avatar-color-blue')[0].props.accessibilityState.selected).toBe(true);
  // Unchosen drawings are neutral; the chosen one wears the colour.
  const faces = DOG_ART_KEYS.map(key => byTestId(`avatar-art-${key}`)[0].findByType(DogAvatar).props);
  expect(faces.find(face => face.avatar.art === 'prick').tint).toBeNull();
  expect(faces.filter(face => face.avatar.art !== 'prick').every(face => face.tint === NEUTRAL_TINT)).toBe(true);
  expect(faces.every(face => face.size === 48)).toBe(true);
  expect(renderer.root.findAllByType(DogAvatar)[0].props.size).toBe(80);
});

test('A5: 完成 stores the trimmed name and the face together, then goes back to the card', async () => {
  const { onSaveName, onSaveAvatar, onBack } = await mount();
  await type(' 豆豆二號 ');
  await press('avatar-art-curly');
  await press('avatar-color-mint');
  expect(previewFace()).toEqual({ kind: 'art', art: 'curly', color: 'mint' });
  expect(DOG_COLORS.mint).toBeDefined();
  expect(onSaveName).not.toHaveBeenCalled();
  expect(onSaveAvatar).not.toHaveBeenCalled();
  await press('dog-profile-done');
  expect(onSaveName).toHaveBeenCalledTimes(1);
  expect(onSaveName).toHaveBeenCalledWith('豆豆二號');
  expect(onSaveAvatar).toHaveBeenCalledTimes(1);
  expect(onSaveAvatar).toHaveBeenCalledWith({ kind: 'art', art: 'curly', color: 'mint' });
  // It slides away first (180 ms).
  expect(onBack).not.toHaveBeenCalled();
  await settle();
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('A5: 完成 stores only what changed; nothing changed stores nothing', async () => {
  let handlers = await mount();
  await type('小白');
  await press('dog-profile-done');
  expect(handlers.onSaveName).toHaveBeenCalledWith('小白');
  expect(handlers.onSaveAvatar).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
  handlers = await mount();
  await press('avatar-art-short');
  await press('dog-profile-done');
  expect(handlers.onSaveName).not.toHaveBeenCalled();
  expect(handlers.onSaveAvatar).toHaveBeenCalledWith({ kind: 'art', art: 'short', color: 'coral' });
  await act(async () => renderer.unmount());
  handlers = await mount();
  // Chosen and chosen back: the same face as stored.
  await press('avatar-art-short');
  await press('avatar-art-classic');
  await press('dog-profile-done');
  await settle();
  expect(handlers.onSaveName).not.toHaveBeenCalled();
  expect(handlers.onSaveAvatar).not.toHaveBeenCalled();
  expect(handlers.onBack).toHaveBeenCalledTimes(1);
});

test('A5a: emptied or only spaces — no error, the dog keeps its name', async () => {
  const { onSaveName, onBack } = await mount();
  await type('');
  expect(flatten(renderer.toJSON())).not.toContain('0/20');
  // Nothing to store: 完成 just closes, and 取消 does not ask.
  await press('dog-profile-cancel');
  expect(discardOpen()).toBe(false);
  await settle();
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  const second = await mount();
  await type('   ');
  await press('dog-profile-done');
  await settle();
  expect(second.onSaveName).not.toHaveBeenCalled();
  expect(onSaveName).not.toHaveBeenCalled();
  expect(flatten(renderer.toJSON())).not.toContain(i18nT('c627'));
  expect(second.onBack).toHaveBeenCalledTimes(1);
});

test('A5a: more than 20 characters cannot be typed; the count shows only near the limit', async () => {
  await mount();
  await type('一二三四五六七八九十一二三四五六七八九十一二');
  expect(input().props.value).toBe('一二三四五六七八九十一二三四五六七八九十');
  expect(flatten(renderer.toJSON())).toContain('20/20');
  for (const [length, visible] of [[15, false], [16, true], [20, true], [5, false]]) {
    await type('一'.repeat(length));
    expect(hostCount('dog-name-count') > 0).toBe(visible);
  }
});

test('a dog never named starts with an empty input, 「狗的名字」 in grey', async () => {
  const { onSaveName } = await mount({ name: '狗 5', alias: '', slaveId: 5 });
  expect(flatten(renderer.toJSON())).toContain('訊號源 5');
  expect(input().props.value).toBe('');
  expect(input().props.placeholderTextColor).toBe(colors.textMuted);
  await type('阿福');
  await press('dog-profile-done');
  expect(onSaveName).toHaveBeenCalledWith('阿福');
});

test('A5: 取消, back and the dimmed card store nothing; with nothing changed they just close', async () => {
  let handlers = await mount();
  await press('dog-profile-cancel');
  await settle();
  expect(handlers.onBack).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  handlers = await mount();
  await pressBack();
  await settle();
  expect(handlers.onBack).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  handlers = await mount();
  // The dimmed card above the sheet is a 取消 too.
  expect(byTestId('dog-profile-scrim')[0].props.accessibilityLabel).toBe(i18nT('c046'));
  await press('dog-profile-scrim');
  await settle();
  expect(handlers.onBack).toHaveBeenCalledTimes(1);
  expect(handlers.onSaveName).not.toHaveBeenCalled();
  expect(handlers.onSaveAvatar).not.toHaveBeenCalled();
});

test('A5: with a change made, 取消 asks first — 繼續編輯 keeps it, 放棄修改 drops it', async () => {
  const { onSaveName, onSaveAvatar, onBack } = await mount();
  await type('小白');
  await press('avatar-color-mint');
  await press('dog-profile-cancel');
  expect(discardOpen()).toBe(true);
  const dialog = renderer.root.findByType(ConfirmDialog).props;
  expect(dialog).toMatchObject({ title: i18nT('c1332'), body: i18nT('c1333'), cancelLabel: i18nT('c1334'),
    confirm: i18nT('c1335'), destructive: true });
  expect(flatten(renderer.toJSON())).toContain(`${i18nT('c1334')}${i18nT('c1335')}`);
  // The keyboard is put away for the dialog.
  expect(Keyboard.dismiss).toHaveBeenCalled();
  await press('dog-profile-discard-cancel');
  expect(discardOpen()).toBe(false);
  expect(input().props.value).toBe('小白');
  expect(previewFace().color).toBe('mint');
  // Back asks too; back again (the dialog's own back) keeps editing.
  await pressBack();
  expect(discardOpen()).toBe(true);
  await pressBack();
  expect(discardOpen()).toBe(false);
  expect(onBack).not.toHaveBeenCalled();
  await press('dog-profile-scrim');
  expect(discardOpen()).toBe(true);
  await press('dog-profile-discard-confirm');
  await settle();
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onSaveName).not.toHaveBeenCalled();
  expect(onSaveAvatar).not.toHaveBeenCalled();
});

test('A5: what could not be stored keeps the sheet and says so; trying again stores only that', async () => {
  const onSaveName = jest.fn(async () => false);
  const { onSaveAvatar, onBack } = await mount({ onSaveName });
  await type('小白');
  await press('avatar-color-purple');
  await press('dog-profile-done');
  await settle();
  expect(onBack).not.toHaveBeenCalled();
  expect(flatten(renderer.toJSON())).toContain(i18nT('c627'));
  expect(input().props.value).toBe('小白');
  expect(onSaveAvatar).toHaveBeenCalledTimes(1);
  // The face is stored: the map hands it back.
  await rerender({ avatar: onSaveAvatar.mock.calls[0][0] });
  onSaveName.mockImplementation(async () => true);
  await press('dog-profile-done');
  await settle();
  expect(onSaveAvatar).toHaveBeenCalledTimes(1);
  expect(onSaveName).toHaveBeenCalledTimes(2);
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('while storing, nothing can be typed, chosen or cancelled', async () => {
  let resolve;
  const onSaveName = jest.fn(() => new Promise(done => { resolve = done; }));
  const { onBack, onSaveAvatar } = await mount({ onSaveName });
  await type('小白');
  await act(async () => { byTestId('dog-profile-done')[0].props.onPress(); });
  expect(input().props.editable).toBe(false);
  expect(byTestId('dog-profile-done')[0].props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(byTestId('dog-profile-cancel')[0].props.disabled).toBe(true);
  await press('avatar-color-mint');
  expect(previewFace().color).toBe('coral');
  await pressBack();
  expect(discardOpen()).toBe(false);
  await act(async () => resolve(true));
  await settle();
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onSaveAvatar).not.toHaveBeenCalled();
});

test('A5: 拍照 puts the cropped photo in the preview; 完成 stores it; 插圖 brings the drawing back', async () => {
  const picker = stubPicker();
  const { onSaveAvatar } = await mount({ picker, avatar: { kind: 'art', art: 'floppy', color: 'sand' } });
  await press('avatar-source-拍照');
  expect(picker.openCamera).toHaveBeenCalled();
  expect(previewFace()).toEqual({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' });
  // With a photo, 插圖 is not chosen and the drawings are put away.
  expect(byTestId('avatar-source-插圖')[0].props.accessibilityState.selected).toBe(false);
  expect(hostCount('avatar-art-classic')).toBe(0);
  await press('avatar-source-插圖');
  expect(previewFace()).toEqual({ kind: 'art', art: 'floppy', color: 'sand' });
  await press('avatar-source-相簿');
  expect(picker.openPicker).toHaveBeenCalled();
  await press('dog-profile-done');
  expect(onSaveAvatar).toHaveBeenCalledWith({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' });
});

test('A5: no camera permission is said in the sheet; nothing else changes', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'E_NO_CAMERA_PERMISSION' });
  const { onSaveAvatar, onBack } = await mount({ picker: stubPicker({ openCamera: jest.fn(async () => { throw denied; }) }) });
  await press('avatar-source-拍照');
  expect(flatten(renderer.toJSON())).toContain(i18nT('c647'));
  await press('dog-profile-cancel');
  expect(discardOpen()).toBe(false);
  await settle();
  expect(onSaveAvatar).not.toHaveBeenCalled();
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('A5: the sheet rides on top of the keyboard, and a choice in the picker puts the keyboard away', async () => {
  const safeArea = require('react-native-safe-area-context');
  jest.spyOn(safeArea, 'useSafeAreaInsets').mockReturnValue({ top: 24, bottom: 48, left: 0, right: 0 });
  await mount();
  expect(sheetStyle().bottom).toBe(0);
  expect(sheetStyle().paddingBottom).toBe(16 + 48);
  await act(async () => input().props.onFocus());
  await act(async () => keyboardListeners.keyboardDidShow({ endCoordinates: { height: 320 } }));
  // React Native's height leaves out the navigation bar the keyboard also covers.
  expect(sheetStyle().bottom).toBe(320 + 48);
  expect(sheetStyle().paddingBottom).toBe(16);
  // Scrolls inside what is left above the keyboard (the test window is 1334 tall).
  expect(sheetStyle().maxHeight).toBe(1334 - 24 - 320 - 48);
  // A tap in the picker works while the keyboard is up.
  const scroll = renderer.root.findByType(ScrollView);
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  await press('avatar-art-curly');
  expect(Keyboard.dismiss).toHaveBeenCalled();
  expect(previewFace().art).toBe('curly');
  await act(async () => keyboardListeners.keyboardDidHide());
  expect(sheetStyle().bottom).toBe(0);
});

test('A5 rises from the bottom over the dimmed card (220 ms), invisible until measured', async () => {
  await act(async () => {
    renderer = Renderer.create(<DogProfile slaveId={4} name="豆豆" alias="豆豆" avatar={null} picker={stubPicker()}
      onSaveName={jest.fn()} onSaveAvatar={jest.fn()} onBack={jest.fn()} />);
  });
  expect(sheetStyle().opacity).toBe(0);
  await act(async () => sheet().props.onLayout({ nativeEvent: { layout: { height: 640 } } }));
  expect([sheet().props.style].flat(3).some(item => item?.opacity === 0)).toBe(false);
  expect(sheet().props.accessibilityViewIsModal).toBe(true);
});

test('after 取消 starts closing, 完成 and the choices do nothing', async () => {
  const { onSaveAvatar, onBack } = await mount();
  await press('dog-profile-cancel');
  // Still sliding away (180 ms).
  await press('avatar-color-mint');
  await press('dog-profile-done');
  await settle();
  expect(onSaveAvatar).not.toHaveBeenCalled();
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('stored names keep 20 characters as the user sees them', () => {
  const { normalizeDogAliases } = require('../src/mapHistory/DogAliases');
  expect(normalizeDogAliases({ 4: '🐶'.repeat(20) })[4]).toBe('🐶'.repeat(20));
  expect(normalizeDogAliases({ 4: ` ${i18nT("c687").repeat(25)} ` })[4]).toBe(i18nT("c687").repeat(20));
});
