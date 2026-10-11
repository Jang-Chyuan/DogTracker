import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform, PixelRatio } from 'react-native';
import { MapButtons } from '../src/map/MapControls';
import { markerFrame } from '../src/map/DogMarkerView';
import MapView, { Marker, Polyline, mockCamera } from 'react-native-maps';
import TrackingMap from '../src/map/TrackingMap';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { denseDogScene } from '../__fixtures__/DenseDogScene';

const originalOS = Platform.OS;
let renderer, p, projected;
const item = id => renderer.root.findAllByProps({ testID: id })[0];
const host = id => renderer.root.find(node => typeof node.type === 'string' && node.props.testID === id);
const rows = () => renderer.root.findAll(node => typeof node.type === 'string' && /^dense-dog-row-/.test(node.props.testID || ''));
const faces = () => renderer.root.findAllByType(Marker).filter(node => /-dog-\d+$/.test(node.props.identifier));
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => jest.advanceTimersByTime(400)); };
async function render(count = 64, two = false) {
  const scene = denseDogScene(count, { two, mpp: 0.05 });
  projected = scene.points;
  p = { provider: GOOGLE_MAP_PROVIDER, source: 'live', dogSelectionScope: 'owner-a',
    foreground: true, topInset: 80, bottomInset: 100, onDogPress: jest.fn(), onMapPress: jest.fn(),
    presentation: { dogMarkers: scene.markers, cameraPositions: scene.markers.map(marker => marker.coordinate),
      slaveSegments: [], rangeRing: null, rangeLines: [] } };
  mockCamera.pointForCoordinate = jest.fn(async coordinate => {
    const marker = p.presentation.dogMarkers.find(dog => dog.coordinate === coordinate);
    return projected[marker?.slaveId] || { x: -1000, y: -1000 };
  });
  mockCamera.coordinateForPoint = jest.fn(async () => ({ latitude: 1, longitude: 1 }));
  mockCamera.getCamera.mockResolvedValue({ center: { latitude: 1, longitude: 1 }, zoom: 19, heading: 0 });
  await act(async () => { renderer = Renderer.create(<TrackingMap {...p} />); });
  await act(async () => item('tracking-map-container').props.onLayout({ nativeEvent: { layout: { width: 600, height: 800 } } }));
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  await settle();
}
beforeEach(() => { jest.useFakeTimers(); Platform.OS = 'android'; jest.setSystemTime(100000); jest.clearAllMocks(); });
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount()); renderer = null;
  delete mockCamera.pointForCoordinate; delete mockCamera.coordinateForPoint;
  mockCamera.getCamera.mockResolvedValue(null); jest.restoreAllMocks(); Platform.OS = originalOS; jest.useRealTimers();
});

test.each([16, 32, 64])('%i dense native marker handlers always open exactly their own card; picker requires its explicit entry', async count => {
  await render(count);
  expect(faces().map(face => face.props.coordinate)).toEqual(p.presentation.dogMarkers.map(marker => marker.coordinate));
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  // Suppressed names have no broad transparent name canvas; badge/shadow
  // headroom and the exact underlying fix are retained.
  for (const face of faces()) {
    const marker = p.presentation.dogMarkers.find(dog => face.props.identifier === `live-dog-${dog.slaveId}`);
    expect(face.props.anchor).toEqual(markerFrame(marker.size, true).anchor);
  }
  for (const face of faces()) await act(async () => face.props.onPress({ stopPropagation: jest.fn(), nativeEvent: { action: 'marker-press' } }));
  expect(p.onDogPress.mock.calls).toEqual(p.presentation.dogMarkers.map(marker => [marker.slaveId]));
  expect(rows()).toHaveLength(0);
  // Zoom/pan are map gestures, not implicit picker entry points.
  await act(async () => renderer.root.findByType(MapView).props.onPanDrag());
  mockCamera.getCamera.mockResolvedValue({ center: { latitude: 1, longitude: 1 }, zoom: 14, heading: 35 });
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
  await settle(); expect(rows()).toHaveLength(0);
  // A later background map event closes the card, never opens a picker.
  await act(async () => { jest.advanceTimersByTime(1000); renderer.root.findByType(MapView).props.onPress({ nativeEvent: {} }); });
  await act(async () => jest.advanceTimersByTime(1000));
  expect(p.onMapPress).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(0);
  await act(async () => item('dense-dog-entry').props.onPress());
  expect(rows()).toHaveLength(count);
  p.onDogPress.mockClear(); await act(async () => item(`dense-dog-row-${count}`).props.onPress());
  expect(p.onDogPress.mock.calls).toEqual([[count]]); expect(rows()).toHaveLength(0);
});

test.each([16, 32, 64])('%i in two groups preserve selected name, problem identity and offscreen selection without camera chasing', async count => {
  await render(count, true);
  expect(renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'dog-name-tag')).toHaveLength(2);
  expect(renderer.root.findAll(node => typeof node.type === 'string' && /^marker-a11y-\d+$/.test(node.props.testID || ''))).toHaveLength(count);
  const selected = faces().find(face => face.props.identifier === `live-dog-${count}`);
  expect(selected.props.zIndex).toBe(40);
  expect(selected.findAllByProps({ testID: 'dog-name-tag' })).toHaveLength(0);
  const selectedLabel = renderer.root.findAllByType(Marker).find(node => node.props.identifier === `live-dog-label-${count}`);
  expect(selectedLabel.findAllByProps({ testID: 'dog-name-tag' })).not.toHaveLength(0);
  expect(selectedLabel.props.anchor).toEqual({ x: 0.5, y: 0 });
  p.onDogPress.mockClear();
  await act(async () => selectedLabel.props.onPress({ nativeEvent: { action: 'marker-press' } }));
  expect(p.onDogPress.mock.calls).toEqual([[count]]);
  p.onDogPress.mockClear();
  expect(faces().find(face => face.props.identifier === 'live-dog-7').props.zIndex).toBe(34);
  const before = JSON.stringify(p.presentation.dogMarkers), fits = mockCamera.fitToCoordinates.mock.calls.length;
  projected = { ...projected, [count]: { x: -500, y: 240 } };
  await act(async () => renderer.root.findByType(MapView).props.onPanDrag());
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
  await settle();
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(fits);
  expect(mockCamera.animateCamera).not.toHaveBeenCalled();
  await act(async () => item('dense-dog-entry').props.onPress());
  expect(item(`dense-dog-row-${count}`).props.accessibilityState.selected).toBe(true);
  await act(async () => item(`dense-dog-row-${count}`).props.onPress());
  expect(p.onDogPress).toHaveBeenLastCalledWith(count);
  expect(JSON.stringify(p.presentation.dogMarkers)).toBe(before);
});

test('owner scope, live-to-history and foreground fences dismiss a picker without accepting stale selection', async () => {
  await render(16);
  await act(async () => item('dense-dog-entry').props.onPress());
  const old = item('dense-dog-row-7').props.onPress;
  p = { ...p, dogSelectionScope: 'owner-b' };
  await act(async () => renderer.update(<TrackingMap {...p} />));
  expect(rows()).toHaveLength(0); await act(async () => old()); expect(p.onDogPress).not.toHaveBeenCalled();
  await act(async () => item('dense-dog-entry').props.onPress());
  const beforeBackground = item('dense-dog-row-7').props.onPress;
  await act(async () => renderer.update(<TrackingMap {...p} foreground={false} />));
  expect(rows()).toHaveLength(0);
  await act(async () => beforeBackground()); expect(p.onDogPress).not.toHaveBeenCalled();
  await act(async () => renderer.update(<TrackingMap {...p} presentation={{ ...p.presentation, historyMode: true }} />));
  expect(renderer.root.findAllByProps({ testID: 'dense-dog-entry' })).toHaveLength(0);
});

test('large-font actual controls height excludes covered names without moving the SDK padding/camera', async () => {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
  await render(16);
  projected = Object.fromEntries(Object.entries(projected).map(([id, point]) => [id, { ...point, y: 460 }]));
  await act(async () => renderer.root.findByType(MapView).props.onRegionChangeComplete({}, { isGesture: true }));
  await settle();
  const tags = () => renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'dog-name-tag');
  expect(tags()).toHaveLength(1);
  const fits = mockCamera.fitToCoordinates.mock.calls.length;
  await act(async () => renderer.root.findByType(MapButtons).props.onControlsLayout({ nativeEvent: { layout: { height: 180 } } }));
  expect(tags()).toHaveLength(0);
  expect(renderer.root.findByType(MapView).props.mapPadding.bottom).toBe(100);
  expect(mockCamera.fitToCoordinates).toHaveBeenCalledTimes(fits);
  // Identity is independent from the control layout, including hidden labels.
  expect(host('marker-a11y-16').props.accessibilityLabel).toBe('Dog 16');
});

// Native two-group taps showed a neighbouring dog's broad named bitmap
// winning above a visible Dog7 head. Assert actual bitmap geometry as well
// as handler identity; source handlers alone missed this failure.
test('named and unnamed dense faces cannot retain a name-width hit canvas', async () => {
  await render(20, true);
  for (const face of faces()) {
    const marker = p.presentation.dogMarkers.find(dog => face.props.identifier === `live-dog-${dog.slaveId}`);
    expect(face.props.anchor).toEqual(markerFrame(marker.size, true).anchor);
    expect(face.findAllByProps({ testID: 'dog-name-tag' })).toHaveLength(0);
  }
});

test('even selected cropped labels stay below every face so capsule corners cannot steal head taps', async () => {
  await render(20, true);
  const labels = renderer.root.findAllByType(Marker).filter(node => /-dog-label-\d+$/.test(node.props.identifier));
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) for (const face of faces()) expect(label.props.zIndex).toBeLessThan(face.props.zIndex);
  const selected = labels.find(label => label.props.identifier === 'live-dog-label-20');
  const other = labels.find(label => label.props.identifier !== 'live-dog-label-20');
  expect(selected.props.zIndex).toBeGreaterThan(other.props.zIndex);
});
