import { t } from '../../i18n';
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
  return { text: !dayRecords ? emptyText({ subject, today, name }) : !rangeRecords ? t('c318') : null,
    exportEnabled: !empty, cursorEnabled: !empty && hasPoints,
    showSummary: !!dayRecords, showRange: !!dayRecords && hasPoints };
}

// 從 N3 提醒卡、通知或紅色「⚠ N」打開的卡片或設定頁 → back returns to the
// history as it was (flow 返回鍵: 歷史的範圍、游標、加入的狗都保留; 再次進入
// otherwise forgets the cursor and the added dogs). The range itself is in
// RangeMemory (a dragged one) or the day's automatic one, so the day is kept.
/** What the history screen keeps under an alert's card or page. JSON-safe. */
export function historySnapshot({ day, selection, cursorTime = null, inGap = false }, key) {
  const { subject, dogs = [], protagonist = null, rangeOwner, kept = null } = selection || {};
  return {
    key: String(key),
    day,
    selection: {
      subject,
      dogs: dogs.map(dog => ({ ...dog })),
      protagonist,
      ...(rangeOwner !== undefined ? { rangeOwner } : {}),
      kept: kept ? { ...kept } : null,
      message: null,
    },
    cursorTime: Number.isFinite(cursorTime) ? cursorTime : null,
    inGap: !!inGap && Number.isFinite(cursorTime),
  };
}

/** A snapshot usable for this opening (the same subject and entry), or null. */
export function usableSnapshot(restore, { subject, entryId }) {
  if (!restore || !Number.isFinite(restore.day) || !restore.selection) return null;
  const { selection } = restore;
  if (selection.subject !== subject || !Array.isArray(selection.dogs) || !selection.dogs.length) return null;
  // The entry dog may have been removed meanwhile (加入的狗 kept as they were).
  if (subject === 'phone' && entryId !== 'phone') return null;
  return restore;
}
