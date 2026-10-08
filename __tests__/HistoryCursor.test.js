import { cursorLabelBox, intersectsBox, snapToRoute } from '../src/mapHistory/CursorGeometry';

test('cursor remains on a route even when dragged far away and does not bridge gaps', () => {
  const segments = [[{ x: 0, y: 100, time: 0 }, { x: 100, y: 100, time: 1000 }],
    [{ x: 300, y: 100, time: 3000 }, { x: 400, y: 100, time: 4000 }]];
  expect(snapToRoute(segments, { x: 50, y: 500 })).toMatchObject({ x: 50, y: 100, time: 500 });
  expect(snapToRoute(segments, { x: 180, y: 100 })).toMatchObject({ x: 100, y: 100 });
  expect(snapToRoute([], { x: 1, y: 1 })).toBeNull();
});

test('label clears every route segment including lines crossing the box with endpoints outside', () => {
  const segments = [[{ x: 0, y: 300 }, { x: 400, y: 300 }]];
  const box = cursorLabelBox(segments, { x: 200, y: 300 }, 400, 800, 100, 100);
  expect(box).not.toBeNull();
  expect(intersectsBox(segments[0][0], segments[0][1], box)).toBe(false);
  expect(intersectsBox({ x: 0, y: 20 }, { x: 400, y: 20 }, { x: 100, y: 0, width: 100, height: 40 })).toBe(true);
  expect(cursorLabelBox(segments, { x: 1, y: 1 }, 100, 100, 20, 20)).toBeNull();
});

// The 055a cursor handle: a 48dp target over the cursor point that drags it
// along the route (the point and label are a map marker).
describe('the cursor handle', () => {
  const React = require('react');
  const Renderer = require('react-test-renderer');
  const { PanResponder } = require('react-native');
  const HistoryCursor = require('../src/mapHistory/HistoryCursor').default;
  const points = [0, 1, 2, 3].map(i => ({ time: i * 60000, latitude: 25, longitude: 121 + i * 0.001 }));
  const cursorAt = p => ({ time: p.time, coordinate: { latitude: p.latitude, longitude: p.longitude },
    lines: ['09:00', '已走 0.1 km'] });
  // Projection: 100 dp per 0.001° of longitude, the route along y = 300.
  const mapRef = () => ({ current: {
    pointForCoordinate: jest.fn(async p => ({ x: 50 + (p.longitude - 121) * 100000, y: 300 })),
    coordinateForPoint: jest.fn(async p => ({ latitude: 25 + (p.y - 300) * 0.00001, longitude: 121 + (p.x - 50) / 100000 })),
  } });
  const props = { width: 400, height: 800, top: 100, bottom: 100, revision: 0 };

  test('sits over the cursor point and says its two lines to TalkBack', async () => {
    let renderer;
    await Renderer.act(async () => { renderer = Renderer.create(<HistoryCursor {...props} mapRef={mapRef()}
      cursor={cursorAt(points[1])} points={points} />); });
    const handle = renderer.root.findByProps({ testID: 'history-cursor-handle' });
    expect(handle.props.style[1].left).toBeCloseTo(150 - 24);
    expect(handle.props.style[1].top).toBeCloseTo(300 - 24);
    expect(handle.props.accessibilityLabel).toBe('09:00，已走 0.1 km');
    // Hidden off the visible map, or while the app is in the background.
    await Renderer.act(async () => renderer.update(<HistoryCursor {...props} mapRef={mapRef()} hidden
      cursor={cursorAt(points[1])} points={points} />));
    expect(renderer.root.findAllByProps({ testID: 'history-cursor-handle' })).toHaveLength(0);
    await Renderer.act(async () => renderer.unmount());
  });

  test('a drag snaps the finger to the nearest fix; the map stops moving meanwhile', async () => {
    let handlers;
    const spy = jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers = value; return { panHandlers: {} }; });
    const onMove = jest.fn();
    const dragging = jest.fn();
    let renderer;
    try {
      await Renderer.act(async () => { renderer = Renderer.create(<HistoryCursor {...props} mapRef={mapRef()}
        cursor={cursorAt(points[0])} points={points} onMove={onMove} onDraggingChange={dragging} />); });
      await Renderer.act(async () => handlers.onPanResponderGrant());
      expect(dragging).toHaveBeenLastCalledWith(true);
      // 190 dp right, 40 dp off the line: nearest is the fix at x = 250.
      await Renderer.act(async () => handlers.onPanResponderMove(null, { dx: 190, dy: 40 }));
      expect(onMove).toHaveBeenLastCalledWith(points[2].time, 'drag');
      await Renderer.act(async () => handlers.onPanResponderRelease());
      expect(dragging).toHaveBeenLastCalledWith(false);
      // TalkBack steps fix by fix.
      const handle = renderer.root.findByProps({ testID: 'history-cursor-handle' });
      await Renderer.act(async () => handle.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
      expect(onMove).toHaveBeenLastCalledWith(points[1].time, 'drag');
    } finally {
      if (renderer) await Renderer.act(async () => renderer.unmount());
      spy.mockRestore();
    }
  });
});
