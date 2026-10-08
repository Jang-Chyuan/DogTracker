import { dogTransition, dogPresentation, rangeOwner, protagonist, entryDefaults, backAction, BACK_KEY_TABLE, emptyState } from '../src/history/screen';
const initial = { dogs: [], protagonist: null, range: { start: 1, end: 2 }, cursorTime: 2 };
const add = (state, id, hasData = true) => dogTransition(state, { type: 'add', dog: { id, hasData } });
test('2–4 dogs retain shared range, cursor and stable colours, recycling smallest slot', () => {
  let state = add(add(add(add(initial, 'a'), 'b'), 'c'), 'd');
  expect(state.dogs.map(d => d.colourToken)).toEqual(['route1', 'route2', 'route3', 'route4']);
  expect(add(state, 'e').message).toBe('最多同時 4 隻');
  state = dogTransition(state, { type: 'remove', id: 'b' });
  state = add(state, 'e');
  expect(state.dogs.map(d => d.colourToken)).toEqual(['route1', 'route3', 'route4', 'route2']);
  state = dogTransition(state, { type: 'select', id: 'e' });
  expect(state).toMatchObject({ protagonist: 'e', range: initial.range, cursorTime: 2 });
  expect(add(state, 'a').dogs).toHaveLength(4);
});
test('no-data dogs cannot be protagonist unless all empty; data changes use first eligible', () => {
  let state = add(add(initial, 'a', false), 'b', true);
  expect(state.protagonist).toBe('b');
  expect(dogTransition(state, { type: 'select', id: 'a' }).protagonist).toBe('b');
  state = dogTransition(state, { type: 'data', data: {} });
  expect(state.protagonist).toBe('b');
  state = dogTransition(state, { type: 'select', id: 'a' });
  expect(state.protagonist).toBe('a');
  expect(dogTransition(state, { type: 'data', data: { b: true } }).protagonist).toBe('b');
  expect(protagonist([], 'x')).toBe(null);
});
test('remove protagonist selects eligible dog; last dog cannot be removed or recoloured', () => {
  let state = add(add(initial, 'a'), 'b');
  state = dogTransition(state, { type: 'remove', id: 'a' });
  expect(state.protagonist).toBe('b');
  expect(state.dogs[0].colourToken).toBe('route2');
  expect(dogTransition(state, { type: 'remove', id: 'b' }).dogs).toHaveLength(1);
  expect(dogPresentation(state.dogs)[0].removable).toBe(false);
});
test('failed download pill reports retry and can only switch if eligible', () => {
  const state = { ...add(add(initial, 'a'), 'b', false), dogs: [{ id: 'a', hasData: true }, { id: 'b', hasData: false, downloadFailed: true }] };
  expect(dogTransition(state, { type: 'select', id: 'b' })).toMatchObject({ protagonist: 'a', message: '下載失敗　重試' });
  expect(dogPresentation(state.dogs)[1]).toMatchObject({ opacity: 0.4, visible: false });
});
test('date range owner prioritizes retained entry memory then new protagonist', () => {
  const dogs = [{ id: 'a' }, { id: 'b' }];
  expect(rangeOwner(dogs, 'a', 'b', { a: {}, b: {} })).toBe('a');
  expect(rangeOwner(dogs.slice(1), 'a', 'b', { a: {} })).toBe('b');
  expect(rangeOwner(dogs, 'a', 'b', {})).toBe('b');
});
test('entry defaults and return-to-now restore live map/current protagonist card', () => {
  const dog = entryDefaults({ dogId: 'a', today: '2026-10-08', latest: 100 });
  expect(dog).toMatchObject({ panel: 'half', cursorTime: 100, rangeExpanded: false });
  expect(backAction({ ...dog, protagonist: 'b' })).toEqual({ type: 'live-map', card: 'b' });
  expect(backAction({ ...dog, calendar: true }, { returnToNow: true })).toEqual({ type: 'live-map', card: 'a' });
  expect(backAction(entryDefaults({ entry: 'today-distance', today: '2026-10-08' })).card).toBe(null);
  expect(backAction(entryDefaults({ dogId: 'a', fromAlert: true })).card).toBe(null);
});
test.each(BACK_KEY_TABLE)('Back consumes %s → %s', (flag, type) => {
  expect(backAction({ [flag]: true, returnCard: true, protagonist: 'a' })).toEqual({ type });
});
test('month picker back precedes closing calendar; range collapses before exit', () => {
  expect(backAction({ monthPicker: true, calendar: true }).type).toBe('calendar');
  expect(backAction({ rangeExpanded: true }).type).toBe('collapse-range');
});
test.each([
  ['phone', true, '今天還沒有路線'], ['phone', false, '這天沒有路線'], ['dog', true, '這天沒有小黑的紀錄'],
])('H8 %s today=%s', (subject, today, text) => {
  expect(emptyState({ subject, today, name: '小黑', dayRecords: false })).toEqual({ text, exportEnabled: false,
    cursorEnabled: false, showSummary: false, showRange: false });
});
test('empty selected range keeps summary; one fix may export; held-only records count', () => {
  expect(emptyState({ dayRecords: true, rangeRecords: false, hasPoints: true })).toMatchObject({ text: '這段時間沒有紀錄', showSummary: true, showRange: true, exportEnabled: false });
  expect(emptyState({ dayRecords: true, rangeRecords: true, hasPoints: true }).exportEnabled).toBe(true);
  expect(emptyState({ dayRecords: true, rangeRecords: true, hasPoints: false })).toMatchObject({ text: null, exportEnabled: true, cursorEnabled: false });
});
