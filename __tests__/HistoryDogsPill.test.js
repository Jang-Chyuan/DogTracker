import { historyDogsPill as pill, historyDogsSheet as sheet } from '../src/history/screen/HistoryDogsPill';
const dogs = [
  { id: 6, name: '小黑', protagonist: true, color: 'route1' },
  { id: 4, name: '豆豆', color: 'route2' },
  { id: 8, name: '阿福', color: 'route3' },
  { id: 5, name: '狗 5', color: 'route4' },
];
test('one addable dog has plus and invitation; alone and my route are inert', () => {
  expect(pill(dogs.slice(0, 1), dogs)).toMatchObject({ plus: true, caret: false, tappable: true,
    label: '小黑，點兩下加入其他狗', more: 0, faces: [] });
  expect(pill(dogs.slice(0, 1), dogs.slice(0, 1))).toMatchObject({ plus: false, tappable: false, label: '小黑' });
  expect(pill([], dogs, 'phone')).toMatchObject({ name: '我的路線', tappable: false, label: '我的路線' });
});
test('three dogs show two small faces and TalkBack counts; four show +1', () => {
  expect(pill(dogs.slice(0, 3), dogs)).toMatchObject({ faces: dogs.slice(1, 3), more: 0, caret: true,
    label: '小黑，主角，另外 2 隻，點兩下選擇要看的狗' });
  expect(pill(dogs, dogs)).toMatchObject({ faces: dogs.slice(1, 3), more: 1,
    label: '小黑，主角，另外 3 隻，點兩下選擇要看的狗' });
  const switched = dogs.map(d => ({ ...d, protagonist: d.id === 4 }));
  expect(pill(switched).lead).toEqual(switched[1]);
  expect(pill(switched).faces.map(d => d.id)).toEqual([6, 8]);
});
test('sheet excludes selected dogs, protects the protagonist and dims no-record additions', () => {
  const result = sheet(dogs.slice(0, 3), dogs, { 5: false });
  expect(result.full).toBe(false);
  expect(result.shown.map(d => d.removable)).toEqual([false, true, true]);
  expect(result.addable).toEqual([expect.objectContaining({ id: 5, detail: '這天沒有紀錄',
    opacity: 0.4, disabled: false, hasData: false })]);
  expect(sheet(dogs.slice(0, 1), dogs).addable[0].detail).toBe('訊號源 4');
});
test('four dogs disable the whole add section, even dogs with records', () => {
  const result = sheet(dogs, [...dogs, { id: 9, name: '狗 9' }]);
  expect(result).toMatchObject({ full: true, note: '最多同時 4 隻' });
  expect(result.addable[0]).toMatchObject({ disabled: true, opacity: 0.4 });
});
