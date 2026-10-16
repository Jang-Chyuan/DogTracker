// 2026-10-16: swiping the row of dogs paused before it moved on. Each swipe
// drew every face again (new dog objects, new animations); only the faces
// whose state changes (the one left, the one opened) may draw again.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

const drawn = [];
jest.mock('../src/dogs/DogAvatar', () => {
  const { View } = require('react-native');
  return function DogAvatarMock(props) {
    drawn.push(props.avatar?.id);
    return <View />;
  };
});

const DogCarousel = require('../src/map/DogCarousel').default;

const dogs = [4, 5, 6, 8].map(slaveId => ({ slaveId, name: `狗 ${slaveId}`, avatar: { id: slaveId },
  problem: false, stale: false }));

test('switching the open dog draws only the faces whose state changes', async () => {
  let renderer;
  const onSelect = jest.fn();
  await act(async () => {
    renderer = Renderer.create(<DogCarousel dogs={dogs} currentId={4} width={380} onSelect={onSelect} />);
  });
  expect(drawn.sort()).toEqual([4, 5, 6, 8]);
  drawn.length = 0;
  await act(async () => {
    renderer.update(<DogCarousel dogs={dogs} currentId={5} width={380} onSelect={onSelect} />);
  });
  expect(drawn.sort()).toEqual([4, 5]);
  await act(async () => renderer.unmount());
});
