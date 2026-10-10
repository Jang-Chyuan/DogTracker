import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import SeparatedDogMarkers from '../src/map/SeparatedDogMarkers';

test('displaced markers and labels retain their dog identity and true connector origin', async () => {
  const coordinate = { latitude: 200, longitude: 200 };
  const items = [1, 2, 3].map(id => ({ id, coordinate: { ...coordinate }, label: `犬隻 ${id}`, onPress: jest.fn() }));
  const saved = JSON.stringify(items);
  const mapRef = { current: {
    pointForCoordinate: jest.fn(async p => ({ x: p.longitude, y: p.latitude })),
    coordinateForPoint: jest.fn(async p => ({ latitude: p.y, longitude: p.x })),
  } };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<SeparatedDogMarkers items={items} mapRef={mapRef} revision={0}
      ready width={600} height={600} MarkerComponent={Marker}
      renderMarker={(item, display) => <View testID={`dog-${item.id}`} coordinate={display} onPress={item.onPress} />} />);
  });
  expect(JSON.stringify(items)).toBe(saved);
  const avatars = items.map(item => renderer.root.findByProps({ testID: `dog-${item.id}` }));
  expect(new Set(avatars.map(avatar => JSON.stringify(avatar.props.coordinate))).size).toBe(3);
  items.forEach((item, i) => {
    avatars[i].props.onPress();
    expect(item.onPress).toHaveBeenCalledTimes(1);
  });
  const labels = renderer.root.findAllByType(Marker);
  expect(labels.map(label => label.findByType(Text).props.children)).toEqual(items.map(item => item.label));
  const lines = renderer.root.findAllByType(Polyline);
  avatars.filter(avatar => JSON.stringify(avatar.props.coordinate) !== JSON.stringify(coordinate)).forEach(avatar => {
    expect(lines.some(line => JSON.stringify(line.props.coordinates) === JSON.stringify([coordinate, avatar.props.coordinate]))).toBe(true);
  });
  await act(async () => renderer.unmount());
});
