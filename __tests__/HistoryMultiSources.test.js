import { multiSourcePicker as picker, selectMultiSource } from '../src/history/screen';
const rows = [
  { time: 0, source: 'ble', slave_id: 1 }, { time: 10, source: 'cloud', slave_id: 2 },
  { time: 20, source: 'cloud', slave_id: 1 }, { time: 30, source: 'local', slave_id: 1 },
];
test('exact design options, all default, subject/day boundaries and packet-only availability', () => {
  const model = picker(rows, { subjectId: 1, dayStart: 0, dayEnd: 20 });
  expect(model.options.map(o => o.label)).toEqual(['全部', '這支手機收到的', '雲端']);
  expect(model.options.map(o => o.available)).toEqual([true, true, false]);
  expect(model.label).toBe('資料來源：全部 ›');
  expect(picker(rows, { subjectId: 1, dayStart: 20, dayEnd: 30 }).options.map(o => o.available)).toEqual([true, false, true]);
});
test('cloud metadata, explicit empty source, immediate selection and unknown choice', () => {
  const model = picker([], { cloudAvailable: true, source: 'local' });
  expect(model.options.map(o => o.available)).toEqual([true, false, true]);
  expect(model.label).toBe('資料來源：這支手機收到的 ›');
  expect(selectMultiSource(model, 'cloud')).toMatchObject({ selected: 'cloud', open: false, label: '資料來源：雲端 ›' });
  expect(selectMultiSource(model, 'receiver')).toBe(model);
  expect(picker([], { source: 'bad' }).selected).toBe('all');
});
test('H8 keeps sources, my route hides them', () => {
  expect(picker([])).toMatchObject({ visible: true, selected: 'all' });
  expect(picker([]).options.every(o => o.enabled && !o.available)).toBe(true);
  expect(picker(rows, { subject: 'phone' })).toEqual({ visible: false, options: [], selected: null, label: null });
});
