import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { TopRow } from '../src/mapHistory/HistoryScreen';
import DogAvatar from '../src/dogs/DogAvatar';
import { ThemeProvider, darkTheme } from '../src/theme/ThemeProvider';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn() }));

const dogs = [1, 2, 3, 4].map(id => ({ id, name: `狗 ${id}`, protagonist: id === 1,
  color: darkTheme.colors[`route${id}`] }));
test('fixed row has one pill, 26dp hero with 2dp ring and two 18dp faces; dark outline uses theme', async () => {
  useColorScheme.mockReturnValue('dark');
  let renderer;
  await act(async () => { renderer = Renderer.create(<ThemeProvider><TopRow top={0} subject="dog"
    dogs={dogs} nameOf={dog => dog.name} onAdd={() => {}} onBack={() => {}} onExport={() => {}}
    warningCount={2} exportEnabled /></ThemeProvider>); });
  expect(renderer.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(renderer.root.findAllByType(DogAvatar).map(node => node.props.size)).toEqual([26, 18, 18]);
  const styles = renderer.root.findAll(node => typeof node.type === 'string').map(node => StyleSheet.flatten(node.props.style));
  expect(styles).toContainEqual(expect.objectContaining({ borderWidth: 2, borderColor: dogs[0].color }));
  expect(styles).toContainEqual(expect.objectContaining({ borderLeftWidth: 1, borderLeftColor: darkTheme.colors.line }));
  expect(styles).toContainEqual(expect.objectContaining({ backgroundColor: darkTheme.colors.surface,
    borderColor: darkTheme.colors.floatingOutline }));
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('+1');
  expect(text).toContain('⚠ 2');
  await act(async () => renderer.unmount());
});
