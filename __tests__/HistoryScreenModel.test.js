import { historyTimeline } from '../src/history/HistoryTimeline';
import { screenDayModel, sharedRecords, changeDogDay, cursorLabel } from '../src/history/screen';
const rows = [0, 60000, 120000, 180000].map((time, i) => ({ time, latitude: 25 + i * 0.0001, longitude: 121, source: 'local', accuracy: 5 }));
const options = { subject: 'phone', dayStart: 0, dayEnd: 86400000, today: true, now: 240000 };
test('day adapter retains existing source/timeline semantics and exposes observation distance edges', () => {
  const model = screenDayModel(rows, options);
  const existing = historyTimeline(rows, options);
  expect(model.points).toEqual(existing.points);
  expect(model.distanceM).toBe(existing.distanceM);
  expect(model.cursor.time).toBe(180000);
  expect(model.screenRange).toMatchObject({ end: 240000, lastRecord: 180000 });
  expect(model.distanceEdges).toHaveLength(3);
  expect(cursorLabel(model, 180000, 'phone')[1]).toBe(model.cursor.label[1]);
});
test('adapter preserves manual clipping and valid following after reconciliation', () => {
  const model = screenDayModel(rows, { ...options, manual: { start: 60000, end: 120000, following: false } });
  expect(model.points.map(p => p.time)).toEqual([60000, 120000]);
  expect(model.departure.manual).toBe(true);
  expect(model.screenRange.following).toBe(false);
  const updated = screenDayModel(rows, { ...options, manual: { start: 120000, end: 120000 }, reconcile: true });
  expect(updated.screenRange.manual).toBe(false);
});
test('adapter is safe with empty data and midnight freezes old selected day', () => {
  expect(screenDayModel([], options).cursor.hidden).toBe(true);
  expect(screenDayModel(rows, { ...options, today: false }).screenRange).toMatchObject({ end: 180000, following: false });
});
test('cursor cumulative distance uses measured edges, not proportional list distance', () => {
  const model = { locations: [], sections: [{ start: 0, end: 120000, countedDistanceM: 1000 }],
    distanceEdges: [{ start: 0, end: 60000, countedDistanceM: 900 }, { start: 60000, end: 120000, countedDistanceM: 100 }] };
  expect(cursorLabel(model, 60000)[1]).toBe('已移動 0.9 km');
});
test('date changes resolve eligible protagonist, memory priority, then latest cursor', () => {
  const state = { entryId: 'a', protagonist: 'a', dogs: [{ id: 'a' }, { id: 'b' }], source: 'all' };
  const models = { a: { dayRecords: false, points: [] }, b: { dayRecords: true, points: rows, screenRange: { start: 0, end: 180000 } } };
  const remembered = { a: { start: 60000, end: 120000 }, b: { start: 0, end: 60000 } };
  expect(changeDogDay(state, '2026-10-03', models, remembered)).toMatchObject({ protagonist: 'b', range: remembered.a, cursorTime: 120000, listPosition: 'start' });
  expect(changeDogDay({ ...state, dogs: [{ id: 'b' }] }, '2026-10-03', models, remembered).range).toBe(remembered.b);
  expect(changeDogDay(state, '2026-10-03', models).range).toBe(models.b.screenRange);
  expect(sharedRecords({ a: { points: rows }, b: { points: rows.slice(1) } })).toEqual(rows);
});
