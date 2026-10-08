import { getTheme } from '../../theme/ThemeProvider';
import { dogTransition } from './HistoryScreenDogs';

/** H7 is dogs only; my route is a separate single-subject entry. IDs and
 * avatars come from the caller's dog catalogue. Selection order is add order.
 * Colours belong to selected IDs, never the protagonist or catalogue order. */
export function multiSelection(subjects = [], { subject = 'dog' } = {}) {
  const { colors } = getTheme();
  let state = { dogs: [], protagonist: null, subject, message: null };
  if (subject === 'phone')
    return {
      ...state,
      protagonist: 'phone',
      dogs: [
        {
          id: 'phone',
          name: '我的路線',
          subject: 'phone',
          hasData: !!subjects[0]?.hasData,
          colour: colors.phone,
        },
      ],
    };
  for (const dog of subjects)
    state = dogTransition(state, { type: 'add', dog });
  return state;
}

export function multiSelectionTransition(state, event) {
  if (state.subject === 'phone') return state;
  return dogTransition(state, event);
}
