import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder, StyleSheet, Platform } from 'react-native';
import { cursorLabelPlacement, cursorCameraTarget, measuredCursorFrame } from '../src/mapHistory/CursorLabelPlacement';
import { CursorLabelView, CursorMarkerView, CursorFaceView, cursorLabelFootprint, cursorAnchor } from '../src/mapHistory/HistoryMapMarkers';
import HistoryCursor from '../src/mapHistory/HistoryCursor';
import { TopRow } from '../src/mapHistory/HistoryScreen';

const size = cursorLabelFootprint({ width: 140, height: 46 });
const view = { left: 8, right: 392, top: 44, bottom: 400 };
const back = { x: 8, y: 60, width: 100, height: 44 };
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('native label stays unchanged when the whole measured label is clear', () => {
  expect(cursorLabelPlacement({ x: 200, y: 240 }, size, view, [back])).toEqual({ hidden: false, box: null });
});

test('visible true dot with label under back uses one lower bubble without moving the point', () => {
  const point = Object.freeze({ x: 94, y: 130 });
  const result = cursorLabelPlacement(point, size, view, [back]);
  expect(result.hidden).toBe(true);
  expect(result.box).not.toBeNull();
  expect(overlap(result.box, back)).toBe(false);
  expect(result.box.y).toBeGreaterThan(point.y + size.below);
  expect(point).toEqual({ x: 94, y: 130 });
});

test.each([8, 390])('actual width rather than longitude protects the screen edge at x %s', x => {
  const result = cursorLabelPlacement({ x, y: 240 }, size, view, []);
  expect(result.hidden).toBe(true);
  expect(result.box.x).toBeGreaterThanOrEqual(view.left);
  expect(result.box.x + result.box.width).toBeLessThanOrEqual(view.right);
});

test('very long glyphs and expanded 20dp space fail closed instead of forcing a 1dp fit or new clock', () => {
  expect(cursorLabelPlacement({ x: 100, y: 130 }, { ...size, width: 500 }, view, [back])).toEqual({ hidden: true, box: null });
  const narrow = { ...view, top: 104, bottom: 124 };
  expect(cursorCameraTarget(size, narrow, [back])).toBeNull();
  expect(measuredCursorFrame({ top: 16, left: 24, right: 24, bottom: 20 }, size, narrow, [back])).toBeNull();
});

test('requested camera target clears both actual control and pin/label and measured frame has room', () => {
  const target = cursorCameraTarget(size, view, [back]);
  expect(target).not.toBeNull();
  expect(cursorLabelPlacement(target, size, view, [back])).toEqual({ hidden: false, box: null });
  const padding = measuredCursorFrame({ top: 16, left: 24, right: 24, bottom: 20 }, size, view, [back]);
  expect(padding.top).toBe(size.above + 8 + back.y + back.height - view.top);
  expect(padding.left).toBe(size.width / 2 + 8);
  expect(view.bottom - view.top - padding.top - padding.bottom).toBeGreaterThan(0);
});

test('measured face/name lower footprint changes candidate clearance without changing its anchor', () => {
  const face = cursorLabelFootprint({ width: 160, height: 46 }, true, { width: 200, height: 140 });
  const anchor = cursorAnchor(46, true);
  expect(face.pinHalf).toBe(96);
  expect(face.above + face.below).toBe(140);
  expect(cursorLabelPlacement({ x: 100, y: 160 }, face, view, [{ x: 8, y: 44, width: 230, height: 100 }]).hidden).toBe(true);
  expect(cursorAnchor(46, true)).toEqual(anchor);
});

test.each([CursorMarkerView, CursorFaceView])('measured label pixels remain laid out when hidden (%s)', Component => {
  let tree;
  const measured = jest.fn();
  act(() => { tree = Renderer.create(<Component lines={['09:19', '長文字停留七分鐘']} color="#123456"
    face={{ name: '虛構測試狗' }} labelHidden onLabelLayout={measured} />); });
  const label = tree.root.findByType(CursorLabelView);
  const box = label.findAll(node => typeof node.type === 'string' && node.props.onLayout)[0];
  expect(StyleSheet.flatten(box.props.style).opacity).toBe(0);
  expect(StyleSheet.flatten(box.props.style).display).toBeUndefined();
  act(() => box.props.onLayout({ nativeEvent: { layout: { width: 195, height: 46 } } }));
  expect(measured).toHaveBeenCalledWith({ width: 195, height: 46 });
  expect(label.findAll(node => node.type === 'Text').map(node => node.props.children)).toEqual(['09:19', '長文字停留七分鐘']);
  act(() => tree.unmount());
});

test('TopRow waits for all actual controls, accounts for row origin, and accepts mirrored RTL layout', () => {
  let tree;
  const measured = jest.fn();
  const props = { top: 24, subject: 'phone', dogs: [], nameOf: dog => dog.name, onBack: jest.fn(),
    onExport: jest.fn(), exportEnabled: true, onControlRects: measured };
  act(() => { tree = Renderer.create(<TopRow {...props} />); });
  const host = id => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id)[0];
  const row = tree.root.findAll(node => typeof node.type === 'string' && node.props.pointerEvents === 'box-none' && node.props.onLayout)[0];
  act(() => row.props.onLayout({ nativeEvent: { layout: { x: 8, y: 24, width: 384, height: 44 } } }));
  expect(measured).toHaveBeenLastCalledWith({ boxes: [], ready: false });
  act(() => host('history-back-now').props.onLayout({ nativeEvent: { layout: { x: 290, y: 4, width: 94, height: 36 } } }));
  expect(measured.mock.calls.at(-1)[0].ready).toBe(false);
  act(() => host('history-export').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 44, height: 44 } } }));
  expect(measured).toHaveBeenLastCalledWith({ ready: true, boxes: [
    { x: 292, y: 22, width: 106, height: 48 }, { x: 6, y: 22, width: 48, height: 48 },
  ] });
  act(() => tree.unmount());
});

test('single collision overlay preserves handle coordinate/time, gives way to drag tip, and drops stale projection', async () => {
  let tree, handlers, resolveOld;
  const spy = jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers = value; return { panHandlers: {} }; });
  const projection = jest.fn();
  const mapRef = { current: { pointForCoordinate: jest.fn().mockResolvedValue({ x: 94, y: 130 }) } };
  const cursor = { time: 1, coordinate: { latitude: 25, longitude: 121 }, lines: ['09:19', '停留 7 分'] };
  const props = { mapRef, cursor, points: [{ ...cursor.coordinate, time: 1 }], revision: 0,
    width: 400, height: 800, top: 44, bottom: 400, onProjection: projection,
    labelPlacement: cursorLabelPlacement({ x: 94, y: 130 }, size, view, [back]) };
  const hosts = id => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  try {
    await act(async () => { tree = Renderer.create(<HistoryCursor {...props} />); });
    expect(hosts('history-cursor-collision-label')).toHaveLength(1);
    expect(hosts('history-cursor-collision-label')[0].props.importantForAccessibility).toBe('no-hide-descendants');
    const handleStyle = StyleSheet.flatten(hosts('history-cursor-handle')[0].props.style);
    expect(handleStyle).toMatchObject({ left: 70, top: 106 });
    expect(hosts('history-cursor-handle')[0].props.accessibilityLabel).toBe('09:19，停留 7 分');
    await act(async () => handlers.onPanResponderGrant());
    expect(hosts('history-cursor-collision-label')).toHaveLength(0);
    expect(hosts('history-cursor-drag-time')).toHaveLength(1);
    await act(async () => handlers.onPanResponderRelease());
    expect(hosts('history-cursor-collision-label')).toHaveLength(1);
    mapRef.current.pointForCoordinate.mockImplementationOnce(() => new Promise(done => { resolveOld = done; }));
    await act(async () => tree.update(<HistoryCursor {...props} revision={1} />));
    expect(hosts('history-cursor-handle')).toHaveLength(0); // old projection is never used under a new viewport/revision
    await act(async () => tree.update(<HistoryCursor {...props} revision={2} />));
    const count = projection.mock.calls.length;
    await act(async () => resolveOld({ x: 390, y: 44 }));
    expect(projection).toHaveBeenCalledTimes(count);
    expect(StyleSheet.flatten(hosts('history-cursor-handle')[0].props.style)).toMatchObject(handleStyle);
  } finally { if (tree) await act(async () => tree.unmount()); spy.mockRestore(); }
});

describe('actual Google renderer label and requested camera boundary', () => {
  const TrackingMap = require('../src/map/TrackingMap').default;
  const { GOOGLE_MAP_PROVIDER } = require('../src/map/GoogleMapProvider');
  const NativePlatform = require('../specs/NativeTrackingPlatform').default;
  const { default: MapView, Marker, mockCamera } = require('react-native-maps');
  let tree;
  const originalOS = Platform.OS;
  const coordinate = Object.freeze({ latitude: 25, longitude: 121 });
  const controls = [{ x: 8, y: 60, width: 100, height: 44 }];
  const defaults = { provider: GOOGLE_MAP_PROVIDER, source: 'source-one', topInset: 44, bottomInset: 400,
    foreground: true, historyControls: { boxes: controls, ready: false },
    presentation: { historyMode: true, cameraPositions: [], dogMarkers: [], slaveSegments: [],
      historyRoute: { lines: [], times: [], places: [], points: [{ ...coordinate, time: 1 }],
        camera: [coordinate, { latitude: 25.01, longitude: 121.01 }], color: '#123456',
        cursor: { coordinate, time: 1, key: 'cursor-one', lines: ['09:19', '停留 7 分'] } } } };
  const hosts = id => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  const bitmap = () => tree.root.findAllByType(CursorLabelView).find(node => node.props.onLabelHeight);
  const marker = () => tree.root.findAllByType(Marker).find(node => node.props.anchor?.y > .5);
  const measure = async () => {
    await act(async () => {
      bitmap().props.onLabelHeight(46);
      bitmap().props.onLabelLayout({ width: 140, height: 46 });
      marker().findAll(node => typeof node.type === 'string' && node.props.collapsable === false && node.props.onLayout)[0]
        .props.onLayout({ nativeEvent: { layout: { width: 148, height: 85 } } });
    });
  };
  async function mount(extra = {}) {
    await act(async () => { tree = Renderer.create(<TrackingMap {...defaults} {...extra} />); });
    await act(async () => hosts('tracking-map-container')[0].props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    await act(async () => tree.root.findByType(MapView).props.onMapReady());
    await act(async () => tree.root.findByType(MapView).props.onMapLoaded());
  }
  beforeEach(() => {
    jest.useFakeTimers(); Platform.OS = 'android'; NativePlatform.isMapConfigured.mockReturnValue(true);
    mockCamera.pointForCoordinate = jest.fn().mockResolvedValue({ x: 94, y: 130 });
    mockCamera.coordinateForPoint = jest.fn().mockResolvedValue({ latitude: 25.005, longitude: 121.005 });
    mockCamera.animateCamera.mockClear(); mockCamera.animateToRegion.mockClear(); mockCamera.fitToCoordinates.mockClear();
  });
  afterEach(async () => {
    if (tree) await act(async () => tree.unmount()); tree = null;
    delete mockCamera.pointForCoordinate; delete mockCamera.coordinateForPoint; Platform.OS = originalOS; jest.useRealTimers();
  });

  test('before controls/footprint arrive no wrong card flashes; afterward single overlay keeps exact native coordinate/anchor and no camera grab', async () => {
    await mount();
    expect(bitmap().props.hidden).toBe(true);
    expect(hosts('history-cursor-collision-label')).toHaveLength(0);
    await measure();
    expect(bitmap().props.hidden).toBe(true);
    expect(hosts('history-cursor-collision-label')).toHaveLength(0);
    const anchor = marker().props.anchor;
    await act(async () => tree.update(<TrackingMap {...defaults} historyControls={{ boxes: controls, ready: true }} />));
    expect(hosts('history-cursor-collision-label')).toHaveLength(1);
    expect(bitmap().props.hidden).toBe(true);
    expect(marker().props.coordinate).toBe(coordinate);
    expect(marker().props.anchor).toEqual(anchor);
    expect(tree.root.findByType(MapView).props.mapPadding).toMatchObject({ top: 44, bottom: 400 });
    expect(mockCamera.animateCamera).not.toHaveBeenCalled();
    expect(mockCamera.animateToRegion).not.toHaveBeenCalled();
  });

  test('requested jump waits for measurement then moves camera, expanded impossible request preserves it', async () => {
    const focus = { key: 1, coordinate, centre: true };
    await mount({ historyFocus: focus });
    await measure();
    expect(mockCamera.animateCamera).not.toHaveBeenCalled();
    await act(async () => tree.update(<TrackingMap {...defaults} historyFocus={focus} historyControls={{ boxes: controls, ready: true }} />));
    expect(mockCamera.animateCamera).toHaveBeenCalledTimes(1);
    expect(marker().props.coordinate).toBe(coordinate);
    mockCamera.animateCamera.mockClear();
    await act(async () => tree.update(<TrackingMap {...defaults} topInset={104} bottomInset={676}
      historyFocus={{ key: 2, coordinate, centre: true }} historyFrame={{ key: 1 }} historyControls={{ boxes: controls, ready: true }} />));
    expect(mockCamera.animateCamera).not.toHaveBeenCalled();
    expect(mockCamera.animateToRegion).not.toHaveBeenCalled();
    expect(mockCamera.fitToCoordinates).not.toHaveBeenCalled();
    expect(bitmap().props.hidden).toBe(true);
    expect(marker().props.coordinate).toBe(coordinate);
  });

  test('a new user pan cancels an outstanding requested jump instead of grabbing the camera back', async () => {
    await mount({ historyControls: { boxes: controls, ready: true } });
    await measure();
    let resolve;
    mockCamera.pointForCoordinate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => tree.update(<TrackingMap {...defaults} historyControls={{ boxes: controls, ready: true }}
      historyFocus={{ key: 1, coordinate, centre: false }} />));
    await act(async () => tree.root.findByType(MapView).props.onPanDrag());
    await act(async () => resolve({ x: 94, y: 130 }));
    expect(mockCamera.animateCamera).not.toHaveBeenCalled();
    expect(marker().props.coordinate).toBe(coordinate);
  });

  test('projection returning after source switch cannot move the new camera or publish an old overlay', async () => {
    await mount({ historyControls: { boxes: controls, ready: true } });
    await measure();
    let oldResolve;
    mockCamera.pointForCoordinate.mockImplementationOnce(() => new Promise(done => { oldResolve = done; }));
    await act(async () => tree.update(<TrackingMap {...defaults} historyControls={{ boxes: controls, ready: true }}
      historyFocus={{ key: 1, coordinate, centre: false }} />));
    await act(async () => tree.update(<TrackingMap {...defaults} source="source-two" historyControls={{ boxes: controls, ready: true }} />));
    await act(async () => oldResolve({ x: 94, y: 130 }));
    expect(mockCamera.animateCamera).not.toHaveBeenCalled();
    expect(marker().props.coordinate).toBe(coordinate);
  });
});
