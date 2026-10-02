import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import DogEditor from '../src/dogs/DogEditor';
import { DEFAULT_AVATAR, normalizeAvatar } from '../src/dogs/DogArt';

const press = (renderer, label) => act(async () => renderer.root.findAll(
  node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress());

test('a name and an illustration are saved together on 完成', async () => {
  const save = jest.fn(async () => true);
  const close = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<DogEditor slaveId={4} alias="" avatar={null} onSave={save} onClose={close} />);
  });
  const input = renderer.root.findAll(node => node.props.accessibilityLabel === '名稱' && node.props.onChangeText)[0];
  await act(async () => input.props.onChangeText('小黑'));
  await press(renderer, '選插圖');
  await press(renderer, '立耳');
  await press(renderer, '淡薄荷');
  await press(renderer, '完成');
  expect(save).toHaveBeenCalledWith({ name: '小黑', avatar: { kind: 'art', art: 'prick', color: 'mint' } });
  expect(close).toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('a photo comes back cropped and small, and 取消 saves nothing', async () => {
  const picker = {
    openPicker: jest.fn(async () => ({ path: 'file:///copy/original.jpg' })), openCamera: jest.fn(),
    openCropper: jest.fn(async () => ({ data: 'QUJD', mime: 'image/jpeg' })),
    cleanSingle: jest.fn(async () => {}), clean: jest.fn(async () => {}),
  };
  const save = jest.fn();
  const close = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<DogEditor slaveId={6} avatar={null} onSave={save} onClose={close} picker={picker} />);
  });
  await press(renderer, '從相簿選');
  // Cropped to a circle and kept at 256 px, never the original picture.
  expect(picker.openCropper).toHaveBeenCalledWith(expect.objectContaining({
    path: 'file:///copy/original.jpg', width: 256, height: 256, cropperCircleOverlay: true, includeBase64: true,
  }));
  // The full-size original and the cropper's temporary files are deleted.
  expect(picker.cleanSingle).toHaveBeenCalledWith('file:///copy/original.jpg');
  expect(picker.clean).toHaveBeenCalled();
  expect(renderer.root.findAll(node => node.props.testID === 'dog-avatar-photo').length).toBeGreaterThan(0);
  await press(renderer, '取消');
  expect(save).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('a cancelled picker is not an error; a refused camera says what to do', async () => {
  const picker = {
    openPicker: jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'E_PICKER_CANCELLED' }); }),
    openCamera: jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'E_NO_CAMERA_PERMISSION' }); }),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<DogEditor slaveId={6} onSave={jest.fn()} onClose={jest.fn()} picker={picker} />);
  });
  const text = () => JSON.stringify(renderer.toJSON());
  await press(renderer, '從相簿選');
  expect(text()).not.toContain('沒有拿到照片');
  await press(renderer, '拍照');
  expect(text()).toContain('沒有相機權限');
  await act(async () => renderer.unmount());
});

test('only a known illustration or a small JPEG photo is stored', () => {
  expect(normalizeAvatar(DEFAULT_AVATAR)).toEqual(DEFAULT_AVATAR);
  expect(normalizeAvatar({ kind: 'art', art: 'wolf', color: 'mint' })).toBeNull();
  expect(normalizeAvatar({ kind: 'photo', uri: 'file:///sdcard/x.jpg' })).toBeNull();
  expect(normalizeAvatar({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' })).toEqual({ kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' });
});
