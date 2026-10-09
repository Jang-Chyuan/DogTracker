import { cursorLabel, screenCursor, routeCursorTime, refreshCursor, selectCursorNode } from '../src/history/screen';
const minute = 60000;
const model = {
  points: [0, 10, 20, 30, 40, 50, 60].map(n => ({ time: n * minute })),
  locations: [{ type: 'stop', start: 10 * minute, end: 20 * minute, durationMs: 10 * minute },
    { type: 'indoor', start: 40 * minute, end: 50 * minute }],
  sections: [{ type: 'movement', start: 0, end: 10 * minute, countedDistanceM: 1000, mode: 'moving' },
    { type: 'movement', start: 20 * minute, end: 30 * minute, mode: 'ride', countedDistanceM: 0 },
    { type: 'gap', start: 30 * minute, end: 40 * minute },
    { type: 'movement', start: 50 * minute, end: 60 * minute, countedDistanceM: 1000, mode: 'moving' }],
};
test('two-line labels for moving, stop, vehicle, indoor and phone', () => {
  expect(cursorLabel(model, 5 * minute)[1]).toBe('已移動 0.5 km');
  expect(cursorLabel(model, 15 * minute)[1]).toBe('停留 10 分');
  expect(cursorLabel(model, 25 * minute)[1]).toBe('坐車中・不算距離');
  expect(cursorLabel(model, 45 * minute)[1]).toBe('室內・10 分');
  expect(cursorLabel(model, 60 * minute, 'phone')[1]).toBe('已走 2.0 km');
  const driving = { ...model, sections: [{ start: 0, end: 10 * minute, mode: 'driving' }] };
  expect(cursorLabel(driving, 0, 'phone')[1]).toBe('開車中・不算距離');
});
test('drag gaps skips nearest edge; gap row selects preceding fix and stale label', () => {
  expect(screenCursor(model, 34 * minute).time).toBe(30 * minute);
  expect(screenCursor(model, 36 * minute).time).toBe(40 * minute);
  expect(screenCursor(model, 35 * minute, { action: 'gap' })).toMatchObject({ time: 30 * minute, stale: true });
  expect(screenCursor(model, 35 * minute, { action: 'gap' }).label[1]).toContain('這段沒資料');
});
test('shared time stays fixed while protagonist is missing; before first hides', () => {
  expect(screenCursor(model, 36 * minute, { action: 'shared' })).toMatchObject({ time: 36 * minute, point: { time: 30 * minute }, stale: true });
  expect(screenCursor(model, -minute, { action: 'shared' }).hidden).toBe(true);
  expect(screenCursor(model, 70 * minute, { action: 'shared' }).stale).toBe(true);
  expect(screenCursor({ ...model, points: [] }, 0).hidden).toBe(true);
});
test('haptic ticks at ten-minute crossings, double on stay entry, route and node actions', () => {
  const stay = screenCursor(model, 10 * minute, { previous: { time: 0 } });
  expect(stay.haptics).toEqual(['double']);
  expect(screenCursor(model, 11 * minute, { previous: stay }).haptics).toEqual([]);
  expect(screenCursor(model, 60 * minute, { previous: { time: 50 * minute } }).haptics).toEqual(['tick']);
  expect(screenCursor(model, 0, { action: 'route' }).haptics).toEqual(['tick']);
  expect(screenCursor(model, 0, { action: 'node' }).haptics).toEqual(['double']);
});
test('spatial route first; overlapping routes tie by current cursor time', () => {
  const segments = [[{ x: 0, y: 0, time: 0 }, { x: 10, y: 0, time: 100 }],
    [{ x: 0, y: 0, time: 200 }, { x: 10, y: 0, time: 300 }]];
  const points = [0, 100, 200, 300].map(time => ({ time }));
  expect(routeCursorTime(segments, { x: 8, y: 0 }, 250, points)).toBe(300);
  expect(routeCursorTime(segments, { x: 8, y: 0 }, 0, points)).toBe(100);
  expect(routeCursorTime([], { x: 0, y: 0 }, 0, [])).toBe(null);
});
test('new records follow only if cursor was at latest; clipping snaps inward', () => {
  expect(refreshCursor(model, { time: 50 * minute }, { previousLast: 50 * minute }).time).toBe(60 * minute);
  expect(refreshCursor(model, { time: 10 * minute }, { previousLast: 50 * minute }).time).toBe(10 * minute);
  expect(refreshCursor({ ...model, points: model.points.slice(2) }, { time: 0 }, {}).time).toBe(20 * minute);
});

test('node selection jumps to its start; gap row at boundary still gets stale label', () => {
  expect(selectCursorNode(model, model.locations[0])).toMatchObject({ time: 10 * minute, haptics: ['double'] });
  expect(selectCursorNode(model, model.sections[2])).toMatchObject({ time: 30 * minute, stale: true });
});
