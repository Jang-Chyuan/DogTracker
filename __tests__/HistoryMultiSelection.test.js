import { multiSelection, multiSelectionTransition as transition, multiSelectionPresentation as present } from '../src/history/screen';
const dog = id => ({ id, name: id, hasData: true, avatar: { uri: id } });
test('add order, duplicate protection, four slots and full add chip', () => {
  const state = multiSelection(['a', 'b', 'c', 'd'].map(dog));
  expect(state.dogs.map(d => d.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(transition(state, { type: 'add', dog: dog('a') }).dogs).toHaveLength(4);
  expect(transition(state, { type: 'add', dog: dog('e') }).message).toBe('最多同時 4 隻');
  expect(present(state).add).toMatchObject({ label: '＋ 加入', opacity: 0.4 });
});
test('colours/avatars remain tied to IDs across protagonist, removal and catalogue reorder', () => {
  const state = multiSelection(['a', 'b', 'c'].map(dog));
  const next = transition(transition(state, { type: 'select', id: 'c' }), { type: 'remove', id: 'a' });
  expect(next.dogs).toEqual(state.dogs.slice(1));
  expect(present(next, ['c', 'b', 'd'].map(dog)).candidates.map(d => d.id)).toEqual(['d']);
  expect(transition(next, { type: 'add', dog: dog('d') }).dogs[2].slot).toBe(0);
});
test('empty dogs, all empty fallback, last removal, add list copy and independent my route', () => {
  const state = multiSelection([{ ...dog('a'), hasData: false }, dog('b')]);
  expect(state.protagonist).toBe('b');
  expect(present(state).chips[0]).toMatchObject({ opacity: 0.4, selectable: false, visible: false });
  const empty = transition(state, { type: 'data', data: {} });
  expect(transition(empty, { type: 'select', id: 'a' }).protagonist).toBe('a');
  expect(present(state, [{ ...dog('c'), hasData: false }]).candidates[0].detail).toBe('沒有紀錄');
  expect(present(state).emptyText).toBe('沒有其他狗');
  const one = multiSelection([dog('a')]);
  expect(transition(one, { type: 'remove', id: 'a' }).dogs).toHaveLength(1);
  const phone = multiSelection([{ hasData: true }], { subject: 'phone' });
  expect(present(phone).add.visible).toBe(false);
  expect(phone.dogs[0]).toMatchObject({ name: '我的路線', colour: '#1A73E8' });
  expect(transition(phone, { type: 'add', dog: dog('a') })).toBe(phone);
});
