// The native picker and cropper are tested on the phone; jest gets stubs.
const ImageCropPicker = {
  openPicker: jest.fn(async () => ({ path: 'file:///cache/picked.jpg', mime: 'image/jpeg' })),
  openCamera: jest.fn(async () => ({ path: 'file:///pictures/shot.jpg', mime: 'image/jpeg' })),
  openCropper: jest.fn(async () => ({ data: 'AAAA', mime: 'image/jpeg' })),
  cleanSingle: jest.fn(async () => {}),
  clean: jest.fn(async () => {}),
};
export default ImageCropPicker;
