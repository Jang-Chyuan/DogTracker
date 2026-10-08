import { emptyText } from '../HistoryText';

export function entryDefaults({ entry = 'dog-card', dogId = null, today, latest = null, fromAlert = false }) {
  return { entry, entryId: dogId, day: today, protagonist: dogId,
    cursorTime: latest, panel: 'half', rangeExpanded: false, calendar: false, monthPicker: false,
    returnCard: entry === 'dog-card' && !fromAlert };
}

// The first matching transient layer consumes Back. Return-to-now always exits.
export const BACK_KEY_TABLE = [
  ['exportGenerating', 'cancel-export'], ['exportOpen', 'close-export'],
  ['dogSheet', 'close-dog-sheet'],
  ['monthPicker', 'calendar'], ['calendar', 'close-calendar'],
  ['downloading', 'cancel-download'], ['rangeExpanded', 'collapse-range'],
];
export function backAction(state, { returnToNow = false } = {}) {
  if (!returnToNow) {
    const match = BACK_KEY_TABLE.find(([flag]) => state[flag]);
    if (match) return { type: match[1] };
  }
  return { type: 'live-map', card: state.returnCard ? state.protagonist : null };
}
export function emptyState({ subject = 'dog', today = false, name, dayRecords, rangeRecords, hasPoints = false }) {
  const empty = !dayRecords || !rangeRecords;
  return { text: !dayRecords ? emptyText({ subject, today, name }) : !rangeRecords ? '這段時間沒有紀錄' : null,
    exportEnabled: !empty, cursorEnabled: !empty && hasPoints,
    showSummary: !!dayRecords, showRange: !!dayRecords && hasPoints };
}
