import { dogTransition, dogPresentation } from './HistoryScreenDogs';
import { colors } from '../../theme/tokens';

/** H7 is dogs only; my route is a separate single-subject entry. IDs and
 * avatars come from the caller's dog catalogue. Selection order is add order.
 * Colours belong to selected IDs, never the protagonist or catalogue order. */
export function multiSelection(subjects = [], { subject = 'dog' } = {}) {
  let state = { dogs: [], protagonist: null, subject, message: null };
  if (subject === 'phone') return { ...state, protagonist: 'phone', dogs: [
    { id: 'phone', name: '我的路線', subject: 'phone', hasData: !!subjects[0]?.hasData, colour: colors.phone },
  ] };
  for (const dog of subjects) state = dogTransition(state, { type: 'add', dog });
  return state;
}

export function multiSelectionTransition(state, event) {
  if (state.subject === 'phone') return state;
  return dogTransition(state, event);
}

export function multiSelectionPresentation(state, catalogue = []) {
  const phone = state.subject === 'phone';
  const full = state.dogs.length >= 4;
  const candidates = phone ? [] : catalogue.filter(d => !state.dogs.some(s => s.id === d.id))
    .map(d => ({ ...d, detail: d.hasData ? null : '沒有紀錄' }));
  return { chips: dogPresentation(state.dogs).map(d => ({ ...d,
    selected: d.id === state.protagonist, removable: !phone && d.removable,
    selectable: d.hasData || !state.dogs.some(s => s.hasData) })),
    add: { visible: !phone, label: '＋ 加入', opacity: full ? 0.4 : 1,
      message: full ? '最多同時 4 隻' : null },
    candidates, emptyText: candidates.length ? null : '沒有其他狗' };
}
