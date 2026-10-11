import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder, StyleSheet } from 'react-native';
import HistoryCursor from '../src/mapHistory/HistoryCursor';
import { clock } from '../src/history/HistoryText';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const route = [0, 1, 2].map(i => ({ time: new Date(2026, 9, 12, 18, i).getTime(), latitude: 25, longitude: 121 + i * .001 }));
const screenPoint = coordinate => ({ x: 50 + (coordinate.longitude - 121) * 100000, y: 300 });
let tree, handlers, responder;
const hosts = id => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
const hint = () => tree.root.findAll(node => typeof node.type === 'string' && node.type === 'Text').map(node => node.props.children).flat().filter(value => typeof value === 'string');
beforeEach(() => {
  tree = null;
  responder = jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers = value; return { panHandlers: {} }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); responder.mockRestore(); });

async function fixture({ holdCoordinates = false } = {}) {
  const projections = [], coordinates = [], moved = jest.fn(), dragging = jest.fn(), published = jest.fn();
  const mapRef = { current: {
    pointForCoordinate: jest.fn(coordinate => {
      if (coordinate.longitude === route[0].longitude) return Promise.resolve(screenPoint(coordinate));
      const task = deferred(); projections.push({ ...task, coordinate }); return task.promise;
    }),
    coordinateForPoint: jest.fn(point => {
      if (!holdCoordinates) return Promise.resolve({ latitude: 25, longitude: 121 + (point.x - 50) / 100000 });
      const task = deferred(); coordinates.push(task); return task.promise;
    }),
  } };
  const defaults = { mapRef, projectionScope: 'phone:today', revision: 0,
    width: 400, height: 800, top: 80, bottom: 100,
    labelPlacement: { box: { x: 20, y: 200, width: 120 } } };
  function Probe({ extra = {} }) {
    const [point, setPoint] = useState(route[0]);
    return <HistoryCursor {...defaults} cursor={{ time: point.time, coordinate: point, lines: [clock(point.time)] }}
      points={route} onDraggingChange={dragging} onProjection={published}
      onMove={time => { moved(time); setPoint(route.find(value => value.time === time)); }} {...extra} />;
  }
  await act(async () => { tree = Renderer.create(<Probe />); });
  return { Probe, mapRef, projections, coordinates, moved, dragging, published };
}

test('accepted moves retain the exact native handle while cursor projections are pending; release hides the clock and waits for current normal label', async () => {
  const f = await fixture();
  const nativeHandle = hosts('history-cursor-handle')[0];
  expect(hosts('history-cursor-collision-label')).toHaveLength(1);
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
  expect(f.moved).toHaveBeenLastCalledWith(route[1].time);
  expect(hosts('history-cursor-handle')).toHaveLength(1);
  expect(hosts('history-cursor-handle')[0]).toBe(nativeHandle);
  expect(StyleSheet.flatten(nativeHandle.props.style)).toMatchObject({ left: 26, top: 276 });
  expect(hint()).toContain('18:01');
  expect(hosts('history-cursor-collision-label')).toHaveLength(0);
  // A second legal MOVE must remain owned by the same native responder.
  await act(async () => handlers.onPanResponderMove(null, { dx: 200, dy: 0 }));
  expect(f.moved).toHaveBeenLastCalledWith(route[2].time);
  expect(hosts('history-cursor-handle')[0]).toBe(nativeHandle);
  expect(hint()).toContain('18:02');
  const publications = f.published.mock.calls.length;
  await act(async () => f.projections[0].resolve(screenPoint(route[1])));
  expect(f.published).toHaveBeenCalledTimes(publications); // superseded coordinate stays rejected
  expect(hosts('history-cursor-handle')[0]).toBe(nativeHandle);
  await act(async () => handlers.onPanResponderRelease());
  expect(hosts('history-cursor-drag-time')).toHaveLength(0);
  expect(hosts('history-cursor-collision-label')).toHaveLength(0); // no stale normal projection
  await act(async () => f.projections[1].resolve(screenPoint(route[2])));
  expect(hosts('history-cursor-drag-time')).toHaveLength(0);
  expect(hosts('history-cursor-collision-label')).toHaveLength(1);
  expect(StyleSheet.flatten(hosts('history-cursor-handle')[0].props.style).left).toBeCloseTo(226);
  expect(f.dragging).toHaveBeenLastCalledWith(false);
});

test.each([
  ['scope', { projectionScope: 'dog:6:other-day' }], ['camera revision', { revision: 1 }],
  ['width', { width: 500 }], ['height', { height: 700 }], ['top', { top: 90 }],
  ['bottom', { bottom: 200 }],
  ['map owner', { mapRef: { current: { pointForCoordinate: async () => ({ x: 50, y: 300 }) } } }], ['hidden', { hidden: true }], ['missing cursor', { cursor: null }],
])('%s changes cancel ownership and reject a previously pending coordinate read', async (_, extra) => {
  const f = await fixture({ holdCoordinates: true });
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 200, dy: 0 }));
  await act(async () => tree.update(<f.Probe extra={extra} />));
  expect(hosts('history-cursor-drag-time')).toHaveLength(0);
  expect(f.dragging).toHaveBeenLastCalledWith(false);
  await act(async () => f.coordinates[0].resolve(route[2]));
  expect(f.moved).not.toHaveBeenCalled();
});

test('hidden scene rejects its late cursor projection as well as hiding the gesture clock', async () => {
  const f = await fixture();
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
  await act(async () => tree.update(<f.Probe extra={{ hidden: true }} />));
  const publications = f.published.mock.calls.length;
  await act(async () => f.projections[0].resolve(screenPoint(route[1])));
  expect(f.published).toHaveBeenCalledTimes(publications);
  expect(hosts('history-cursor-handle')).toHaveLength(0);
  expect(hosts('history-cursor-drag-time')).toHaveLength(0);
});

test('a released final coordinate still lands, but a replacement gesture fences the older read', async () => {
  const f = await fixture({ holdCoordinates: true });
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
  await act(async () => handlers.onPanResponderRelease());
  expect(hosts('history-cursor-drag-time')).toHaveLength(0);
  await act(async () => f.coordinates[0].resolve(route[1]));
  expect(f.moved).toHaveBeenLastCalledWith(route[1].time);
  expect(hosts('history-cursor-collision-label')).toHaveLength(0);
  await act(async () => f.projections[0].resolve(screenPoint(route[1])));
  expect(hosts('history-cursor-collision-label')).toHaveLength(1);
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: -100, dy: 0 }));
  await act(async () => handlers.onPanResponderRelease());
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
  const accepted = f.moved.mock.calls.length;
  await act(async () => f.coordinates[1].resolve(route[0]));
  expect(f.moved).toHaveBeenCalledTimes(accepted);
  await act(async () => f.coordinates[2].resolve(route[2]));
  expect(f.moved).toHaveBeenLastCalledWith(route[2].time);
});


test('a newly projected offscreen cursor cancels the anchor and rejects a later coordinate read', async () => {
  const f = await fixture({ holdCoordinates: true });
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 100, dy: 0 }));
  await act(async () => f.coordinates[0].resolve(route[1]));
  await act(async () => handlers.onPanResponderMove(null, { dx: 200, dy: 0 }));
  await act(async () => f.projections[0].resolve({ x: 500, y: 300 }));
  expect(hosts('history-cursor-handle')).toHaveLength(0);
  expect(hosts('history-cursor-drag-time')).toHaveLength(0);
  expect(f.dragging).toHaveBeenLastCalledWith(false);
  const accepted = f.moved.mock.calls.length;
  await act(async () => f.coordinates[1].resolve(route[2]));
  expect(f.moved).toHaveBeenCalledTimes(accepted);
});

test('unmount rejects the previous native responder final read and clears its parent drag state', async () => {
  const f = await fixture({ holdCoordinates: true });
  await act(async () => handlers.onPanResponderGrant());
  await act(async () => handlers.onPanResponderMove(null, { dx: 200, dy: 0 }));
  await act(async () => tree.unmount()); tree = null;
  await act(async () => f.coordinates[0].resolve(route[2]));
  expect(f.moved).not.toHaveBeenCalled(); expect(f.dragging).toHaveBeenLastCalledWith(false);
});
