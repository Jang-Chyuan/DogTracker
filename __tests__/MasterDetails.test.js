import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, Switch } from 'react-native';
import MasterDetails from '../src/map/MasterDetails';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

test('Master details are information-only and close by backdrop, close button or Android Back', async () => {
  let renderer, onBack;
  const close = jest.fn(),
    save = jest.fn(),
    remove = jest.fn();
  const listener = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_, callback) => {
      onBack = callback;
      return { remove };
    });
  try {
    await act(async () => {
      renderer = Renderer.create(
        <MasterDetails
          tracking={{ point: trackingPoint, saveTrackingPreferences: save }}
          master={null}
          topInset={80}
          bottomInset={120}
          onClose={close}
        />,
      );
    });
    expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('路徑');
    expect(JSON.stringify(renderer.toJSON())).toContain('領犬員裝置電量');
    for (const label of ['關閉領犬員資訊', '關閉領犬員資訊面板']) {
      const button = renderer.root.findAll(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      )[0];
      await act(async () => button.props.onPress());
    }
    expect(onBack()).toBe(true);
    expect(close).toHaveBeenCalledTimes(3);
    expect(save).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    renderer = null;
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    listener.mockRestore();
  }
});
