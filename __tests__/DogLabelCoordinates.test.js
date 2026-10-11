import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import useDogLabelCoordinates from '../src/map/useDogLabelCoordinates';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let renderer, output;
const coordinate = { latitude: 1, longitude: 1 };
const nextCoordinate = { latitude: 1.0001, longitude: 1.0002 };
const marker = { slaveId: 7, coordinate, size: 48 };
let props, map;
function Probe(p) { output = useDogLabelCoordinates(p); return null; }
beforeEach(() => {
  map = { pointForCoordinate: jest.fn(async () => ({ x: 200, y: 300 })),
    coordinateForPoint: jest.fn(async () => nextCoordinate) };
  props = { mapRef: { current: map }, markers: [marker], tags: { 7: { text: 'Dog 7' } },
    enabled: true, source: 'live', scope: 'owner-a', instance: '1', revision: 0, fontScale: 1 };
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; });
const mount = async () => { await act(async () => { renderer = Renderer.create(<Probe {...props} />); }); };
const update = async p => { props = { ...props, ...p }; await act(async () => renderer.update(<Probe {...props} />)); };
test('label top is offset from true face while original marker coordinate stays exact', async () => {
  await mount();
  expect(map.pointForCoordinate).toHaveBeenCalledWith(coordinate);
  expect(map.coordinateForPoint).toHaveBeenCalledWith({ x: 200, y: 326 });
  expect(output).toEqual([{ slaveId: 7, coordinate: nextCoordinate }]);
  expect(marker.coordinate).toBe(coordinate);
});
test('unchanged native polling object does not restart label queries or blank accepted names', async () => {
  await mount(); const first = output;
  await update({ markers: [{ ...marker, coordinate: { ...coordinate } }], tags: { 7: { text: 'Dog 7' } } });
  expect(map.pointForCoordinate).toHaveBeenCalledTimes(1); expect(output).toBe(first);
});
test.each(['scope', 'source', 'instance', 'revision', 'fontScale'])('late inverse projection cannot accept after %s replacement', async field => {
  const held = deferred(), fresh = deferred();
  map.coordinateForPoint.mockReturnValueOnce(held.promise).mockReturnValueOnce(fresh.promise);
  await mount(); expect(output).toEqual([]);
  await update({ [field]: typeof props[field] === 'number' ? props[field] + 1 : props[field] + '-new' });
  await act(async () => held.resolve(nextCoordinate));
  expect(output).toEqual([]);
  const accepted = { latitude: 2, longitude: 2 };
  await act(async () => fresh.resolve(accepted));
  expect(output).toEqual([{ slaveId: 7, coordinate: accepted }]);
});
test('camera movement hides old labels and discarded async point never continues inverse projection', async () => {
  const held = deferred(); map.pointForCoordinate.mockReturnValueOnce(held.promise);
  await mount(); await update({ enabled: false });
  await act(async () => held.resolve({ x: 200, y: 300 }));
  expect(map.coordinateForPoint).not.toHaveBeenCalled(); expect(output).toEqual([]);
  await update({ enabled: true }); expect(output).toEqual([{ slaveId: 7, coordinate: nextCoordinate }]);
});
test('SDK instance replacement rejects old coordinate even before effect cleanup', async () => {
  const held = deferred(); map.coordinateForPoint.mockReturnValueOnce(held.promise);
  await mount(); props.mapRef.current = { ...map };
  await act(async () => held.resolve(nextCoordinate)); expect(output).toEqual([]);
});
test('unknown/failed projection omits label, never fabricates a fix or continues with old pixel', async () => {
  map.pointForCoordinate.mockResolvedValue({ x: NaN, y: 300 }); await mount();
  expect(output).toEqual([]); expect(map.coordinateForPoint).not.toHaveBeenCalled();
  map.pointForCoordinate.mockRejectedValue(new Error('native unavailable'));
  await update({ revision: 1 }); expect(output).toEqual([]);
});
test('empty and disabled name set has no native projection work', async () => {
  props.tags = {}; await mount(); expect(map.pointForCoordinate).not.toHaveBeenCalled();
  await update({ tags: { 7: { text: 'Dog 7' } }, enabled: false }); expect(map.pointForCoordinate).not.toHaveBeenCalled();
});

test('accepted label cannot reappear on same-key resume before the fresh SDK projection resolves', async () => {
  await mount(); expect(output).toEqual([{ slaveId: 7, coordinate: nextCoordinate }]);
  const held = deferred(); map.coordinateForPoint.mockReturnValueOnce(held.promise);
  await update({ enabled: false }); expect(output).toEqual([]);
  // The SDK can change its projection while backgrounded, before a new
  // camera revision has reached JS. Same key must still wait for this read.
  await update({ enabled: true }); expect(output).toEqual([]);
  expect(map.pointForCoordinate).toHaveBeenCalledTimes(2);
  const fresh = { latitude: 3, longitude: 3 };
  await act(async () => held.resolve(fresh));
  expect(output).toEqual([{ slaveId: 7, coordinate: fresh }]);
});
