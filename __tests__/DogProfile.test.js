import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, Keyboard, TextInput } from 'react-native';
import DogProfile from '../src/dogs/DogProfile';
import AvatarEditor, { NEUTRAL_TINT } from '../src/dogs/AvatarEditor';
import DogAvatar from '../src/dogs/DogAvatar';
import { NAME_MAX, clampName, displayName, nameLength, nameToSave } from '../src/dogs/DogName';
import { CROP_OPTIONS, PHOTO_SIZE, pickPhoto } from '../src/dogs/PhotoAvatar';
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

// ---- the photo (256×256, nothing else kept) ---------------------------------

const stubPicker = (overrides = {}) => ({
  openCamera: jest.fn(async () => ({ path: 'file:///pictures/shot.jpg' })),
  openPicker: jest.fn(async () => ({ path: 'file:///cache/picked.jpg' })),
  openCropper: jest.fn(async () => ({ path: 'file:///cache/cropped.jpg', data: 'AAAA', mime: 'image/jpeg' })),
  cleanSingle: jest.fn(async () => {}),
  clean: jest.fn(async () => {}),
  ...overrides,
});

test('拍照: taken, cropped round to 256×256, and every file it made deleted', async () => {
  const picker = stubPicker();
  expect(await pickPhoto('camera', picker)).toEqual({ avatar: { kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' } });
  expect(picker.openCamera).toHaveBeenCalledWith({ mediaType: 'photo' });
  expect(picker.openPicker).not.toHaveBeenCalled();
  expect(picker.openCropper).toHaveBeenCalledWith(expect.objectContaining({ path: 'file:///pictures/shot.jpg',
    width: 256, height: 256, cropperCircleOverlay: true, includeBase64: true, forceJpg: true }));
  expect(PHOTO_SIZE).toBe(256);
  expect(CROP_OPTIONS.cropperChooseText).toBe('使用');
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

// ---- the page (A5, A5a) -----------------------------------------------------

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

async function mount(props = {}) {
  const handlers = { onSaveName: jest.fn(async () => true), onSaveAvatar: jest.fn(async () => true), onBack: jest.fn() };
  await act(async () => {
    renderer = Renderer.create(<DogProfile slaveId={4} name="豆豆" alias="豆豆" avatar={null} picker={stubPicker()}
      {...handlers} {...props} />);
  });
  return handlers;
}

test('A5: the face with a camera button, the name with a pencil, 訊號源 4; no title', async () => {
  await mount();
  const text = flatten(renderer.toJSON());
  expect(text).toBe('豆豆訊號源 4');
  expect(byTestId('dog-profile-camera')[0].props.accessibilityLabel).toBe('改豆豆的頭像');
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  // 96dp face, 36dp camera with a 48dp target.
  expect(renderer.root.findAllByType(DogAvatar)[0].props.size).toBe(96);
  expect(byTestId('dog-profile-camera')[0].props.hitSlop).toBe(6);
});

test('A5a: tapping the name edits it in place; 完成 stores the trimmed name', async () => {
  const { onSaveName, onBack } = await mount();
  await press('dog-profile-name');
  expect(input().props.value).toBe('豆豆');
  expect(input().props.autoFocus).toBe(true);
  expect(input().props.placeholder).toBe('狗的名字');
  expect(input().props.returnKeyType).toBe('done');
  expect(flatten(renderer.toJSON())).not.toContain('2/20');
  await act(async () => input().props.onChangeText(' 豆豆二號 '));
  expect(flatten(renderer.toJSON())).not.toContain('6/20');
  await act(async () => input().props.onSubmitEditing());
  // 完成 also blurs: stored once.
  await act(async () => input()?.props.onBlur());
  expect(onSaveName).toHaveBeenCalledTimes(1);
  expect(onSaveName).toHaveBeenCalledWith('豆豆二號');
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  expect(onBack).not.toHaveBeenCalled();
});

test('A5a: more than 20 characters cannot be typed', async () => {
  await mount();
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('一二三四五六七八九十一二三四五六七八九十一二'));
  expect(input().props.value).toBe('一二三四五六七八九十一二三四五六七八九十');
  expect(flatten(renderer.toJSON())).toContain('20/20');
});

test('A5a: emptied or only spaces — no error, the dog keeps its name', async () => {
  const { onSaveName } = await mount();
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText(''));
  expect(input().props.placeholder).toBe('狗的名字');
  expect(flatten(renderer.toJSON())).not.toContain('0/20');
  await act(async () => input().props.onSubmitEditing());
  expect(onSaveName).not.toHaveBeenCalled();
  expect(flatten(renderer.toJSON())).toBe('豆豆訊號源 4');
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('   '));
  await act(async () => input().props.onBlur());
  expect(onSaveName).not.toHaveBeenCalled();
  expect(flatten(renderer.toJSON())).not.toContain('沒有存成功');
});

test('A5a: tapping elsewhere or the keyboard going away stores it too', async () => {
  const { onSaveName } = await mount();
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('小白'));
  // The page itself is the "elsewhere".
  await press('dog-profile-outside');
  expect(onSaveName).toHaveBeenLastCalledWith('小白');
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('小灰'));
  await act(async () => keyboardListeners.keyboardDidHide());
  expect(onSaveName).toHaveBeenLastCalledWith('小灰');
  expect(onSaveName).toHaveBeenCalledTimes(2);
});

test('a dog never named starts with an empty input, 「狗的名字」 in grey', async () => {
  const { onSaveName } = await mount({ name: '狗 5', alias: '', slaveId: 5 });
  expect(flatten(renderer.toJSON())).toBe('狗 5訊號源 5');
  await press('dog-profile-name');
  expect(input().props.value).toBe('');
  expect(input().props.placeholderTextColor).toBe(colors.textMuted);
  await act(async () => input().props.onChangeText('阿福'));
  await act(async () => input().props.onSubmitEditing());
  expect(onSaveName).toHaveBeenCalledWith('阿福');
});

test('back while editing stores the name first, then returns to the card', async () => {
  const { onSaveName, onBack } = await mount();
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('小白'));
  await pressBack();
  expect(onSaveName).toHaveBeenCalledWith('小白');
  expect(onBack).toHaveBeenCalledTimes(1);
  // ‹ does the same.
  await press('dog-profile-back');
  expect(onBack).toHaveBeenCalledTimes(2);
});

test('a name that could not be stored keeps the page and says so', async () => {
  const { onBack } = await mount({ onSaveName: jest.fn(async () => false) });
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('小白'));
  await pressBack();
  expect(onBack).not.toHaveBeenCalled();
  expect(flatten(renderer.toJSON())).toContain('沒有存成功，再試一次');
  expect(input().props.value).toBe('小白');
});

// ---- the face (A5c) ---------------------------------------------------------

const openAvatar = async () => {
  await press('dog-profile-camera');
  const sheet = renderer.root.findAll(node => node.props.accessibilityViewIsModal)[0];
  await act(async () => sheet.props.onLayout({ nativeEvent: { layout: { height: 520 } } }));
  await act(async () => { jest.runAllTimers(); });
};
const editorAvatar = () => renderer.root.findByType(AvatarEditor).findAllByType(DogAvatar)[0].props.avatar;

test('A5c: 取消 頭像 完成, 拍照 相簿 插圖, five 樣子 and twelve 底色 in two rows', async () => {
  await mount({ avatar: { kind: 'art', art: 'prick', color: 'blue' } });
  await openAvatar();
  const text = flatten(renderer.toJSON());
  expect(text).toContain('取消頭像完成拍照相簿插圖樣子底色');
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
});

test('A5c: choosing changes only the preview; 完成 stores it, 取消 and back do not', async () => {
  const { onSaveAvatar } = await mount();
  await openAvatar();
  await press('avatar-art-curly');
  await press('avatar-color-mint');
  expect(editorAvatar()).toEqual({ kind: 'art', art: 'curly', color: 'mint' });
  expect(DOG_COLORS.mint).toBeDefined();
  // The page behind still shows the stored face.
  expect(renderer.root.findAllByType(DogAvatar)[0].props.avatar).toBeNull();
  await press('avatar-cancel');
  await act(async () => { jest.runAllTimers(); });
  expect(renderer.root.findAllByType(AvatarEditor)).toHaveLength(0);
  expect(onSaveAvatar).not.toHaveBeenCalled();
  // Back = 取消, and does not leave the page.
  const { onBack } = renderer.root.findByType(DogProfile).props;
  await openAvatar();
  await press('avatar-art-floppy');
  await pressBack();
  await act(async () => { jest.runAllTimers(); });
  expect(renderer.root.findAllByType(AvatarEditor)).toHaveLength(0);
  expect(onSaveAvatar).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
  await openAvatar();
  await press('avatar-art-short');
  await press('avatar-done');
  await act(async () => { jest.runAllTimers(); });
  expect(onSaveAvatar).toHaveBeenCalledWith({ kind: 'art', art: 'short', color: 'coral' });
  expect(renderer.root.findAllByType(AvatarEditor)).toHaveLength(0);
  // Back on the page now leaves it.
  await pressBack();
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('A5c: 拍照 puts the cropped photo in the preview; 完成 stores it; 插圖 brings the drawing back', async () => {
  const picker = stubPicker();
  const { onSaveAvatar } = await mount({ picker, avatar: { kind: 'art', art: 'floppy', color: 'sand' } });
  await openAvatar();
  await press('avatar-source-拍照');
  expect(picker.openCamera).toHaveBeenCalled();
  expect(editorAvatar()).toEqual({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' });
  // With a photo, 插圖 is not chosen and the drawings are put away.
  expect(byTestId('avatar-source-插圖')[0].props.accessibilityState.selected).toBe(false);
  expect(hostCount('avatar-art-classic')).toBe(0);
  await press('avatar-source-插圖');
  expect(editorAvatar()).toEqual({ kind: 'art', art: 'floppy', color: 'sand' });
  await press('avatar-source-相簿');
  expect(picker.openPicker).toHaveBeenCalled();
  await press('avatar-done');
  expect(onSaveAvatar).toHaveBeenCalledWith({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' });
});

test('A5c: no camera permission is said in the sheet; 完成 without a change stores nothing', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'E_NO_CAMERA_PERMISSION' });
  const { onSaveAvatar } = await mount({ picker: stubPicker({ openCamera: jest.fn(async () => { throw denied; }) }) });
  await openAvatar();
  await press('avatar-source-拍照');
  expect(flatten(renderer.toJSON())).toContain('需要相機才能拍照');
  await press('avatar-done');
  await act(async () => { jest.runAllTimers(); });
  expect(onSaveAvatar).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(AvatarEditor)).toHaveLength(0);
});

test('A5c: a face that could not be stored keeps the sheet open', async () => {
  await mount({ onSaveAvatar: jest.fn(async () => false) });
  await openAvatar();
  await press('avatar-color-purple');
  await press('avatar-done');
  await act(async () => { jest.runAllTimers(); });
  expect(renderer.root.findAllByType(AvatarEditor)).toHaveLength(1);
  expect(flatten(renderer.toJSON())).toContain('沒有存成功，再試一次');
});

test('A5c rises from the bottom over a dimmed page (220 ms)', async () => {
  await mount();
  await press('dog-profile-camera');
  const sheet = renderer.root.findAll(node => node.props.accessibilityViewIsModal)[0];
  // Invisible until measured, so it never flashes in place before rising.
  expect([sheet.props.style].flat(3).some(item => item?.opacity === 0)).toBe(true);
  await act(async () => sheet.props.onLayout({ nativeEvent: { layout: { height: 520 } } }));
  expect([sheet.props.style].flat(3).some(item => item?.opacity === 0)).toBe(false);
  // The dimmed page is a 取消 too.
  const scrim = renderer.root.findAll(node => node.props.accessibilityLabel === '取消'
    && node.props.testID !== 'avatar-cancel' && typeof node.props.onPress === 'function')[0];
  expect(scrim).toBeDefined();
});

test('while a name is being stored the input is read-only, so nothing typed is lost', async () => {
  let resolve;
  const onSaveName = jest.fn(() => new Promise(done => { resolve = done; }));
  await mount({ onSaveName });
  await press('dog-profile-name');
  await act(async () => input().props.onChangeText('小白'));
  await act(async () => { input().props.onSubmitEditing(); });
  expect(input().props.editable).toBe(false);
  await act(async () => resolve(true));
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
});

test('A5c: after 取消 starts closing, 完成 and the choices do nothing', async () => {
  const { onSaveAvatar } = await mount();
  await openAvatar();
  await press('avatar-art-curly');
  await press('avatar-cancel');
  // Still sliding away (180 ms).
  await press('avatar-color-mint');
  await press('avatar-done');
  await act(async () => { jest.runAllTimers(); });
  expect(onSaveAvatar).not.toHaveBeenCalled();
});

test('stored names keep 20 characters as the user sees them', () => {
  const { normalizeDogAliases } = require('../src/mapHistory/DogAliases');
  expect(normalizeDogAliases({ 4: '🐶'.repeat(20) })[4]).toBe('🐶'.repeat(20));
  expect(normalizeDogAliases({ 4: ` ${'一'.repeat(25)} ` })[4]).toBe('一'.repeat(20));
});

test('E25: name count appears only near the limit', async () => {
  await mount();
  await press('dog-profile-name');
  for (const [length, visible] of [[15, false], [16, true], [20, true], [5, false]]) {
    await act(async () => input().props.onChangeText('一'.repeat(length)));
    expect(hostCount('dog-name-count') > 0).toBe(visible);
  }
});
