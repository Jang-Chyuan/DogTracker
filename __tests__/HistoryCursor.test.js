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

// Exercise the screen overlay rather than a native draggable marker.
test('overlay gesture projects the cursor onto the route and updates the record time', async () => {
  const React = require('react');
  const Renderer = require('react-test-renderer');
  const { PanResponder } = require('react-native');
  const HistoryCursor = require('../src/mapHistory/HistoryCursor').default;
  let handlers;
  const spy = jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers = value; return { panHandlers: {} }; });
  const points = [0, 1, 2].map(i => ({ id: i, time: i * 1000, latitude: 25, longitude: 121 + i }));
  const tracks = [{ name: '手機', segments: [[points[0], points[2]]], sourcePoints: points }];
  const mapRef = { current: { pointForCoordinate: async p => ({ x: 50 + (p.longitude - 121) * 100, y: 300 }) } };
  let renderer;
  try {
    await Renderer.act(async () => { renderer = Renderer.create(React.createElement(HistoryCursor,
      { tracks, mapRef, revision: 0, width: 400, height: 800, top: 100, bottom: 100 })); });
    await Renderer.act(async () => handlers.onPanResponderGrant());
    await Renderer.act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 200 }));
    const handle = renderer.root.findByProps({ testID: 'history-cursor-handle' });
    expect(handle.props.accessibilityLabel).toContain(new Date(1000).toLocaleString());
    expect(handle.props.style[1]).toEqual({ left: 126, top: 268 });
    await Renderer.act(async () => handlers.onPanResponderRelease());
    // A second gesture must remain mounted even if the native coordinate lookup is slow.
    const originalProject = mapRef.current.pointForCoordinate;
    let finishProjection;
    mapRef.current.pointForCoordinate = () => new Promise(resolve => { finishProjection = resolve; });
    await Renderer.act(async () => handlers.onPanResponderGrant());
    await Renderer.act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
    const second = renderer.root.findByProps({ testID: 'history-cursor-handle' });
    expect(second.props.accessibilityLabel).toContain(new Date(2000).toLocaleString());
    expect(second.props.style[1]).toEqual({ left: 226, top: 268 });
    await Renderer.act(async () => { finishProjection({ x: 250, y: 300 }); });
    await Renderer.act(async () => handlers.onPanResponderRelease());
    mapRef.current.pointForCoordinate = originalProject;
    await Renderer.act(async () => handlers.onPanResponderGrant());
    await Renderer.act(async () => handlers.onPanResponderMove(null, { dx: -100, dy: 0 }));
    await Renderer.act(async () => handlers.onPanResponderRelease());
    const refreshed = [{ ...tracks[0], segments: [[points[2]]], sourcePoints: [points[2]] }];
    await Renderer.act(async () => renderer.update(React.createElement(HistoryCursor,
      { tracks: refreshed, mapRef, revision: 0, width: 400, height: 800, top: 100, bottom: 100, hidden: true })));
    expect(renderer.root.findAllByProps({ testID: 'history-cursor-handle' })).toHaveLength(0);
    await Renderer.act(async () => renderer.update(React.createElement(HistoryCursor,
      { tracks: refreshed, mapRef, revision: 1, width: 400, height: 800, top: 100, bottom: 100 })));
    const locked = renderer.root.findByProps({ testID: 'history-cursor-handle' });
    expect(locked.props.accessibilityLabel).toContain(new Date(1000).toLocaleString());
    expect(locked.props.style[1]).toEqual({ left: 126, top: 268 });
  } finally {
    if (renderer) await Renderer.act(async () => renderer.unmount());
    spy.mockRestore();
  }
});
