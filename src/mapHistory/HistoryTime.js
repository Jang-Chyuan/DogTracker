const pad = value => String(value).padStart(2, '0');

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the day a timestamp falls in. */
export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Both ends of a fixed range are stored as epoch milliseconds: the card now
 * picks them with the platform's own date/time picker instead of parsing what
 * someone typed, and the query needs a real end, not a start plus a duration.
 */
export function parseHistoryRange(startAt, endAt) {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt))
    throw new Error('請選擇開始與結束時間');
  if (endAt <= startAt) throw new Error('結束時間要晚於開始時間');
  if (endAt - startAt > 240 * 3600000) throw new Error('指定區間最長 240 小時');
  return { since: startAt, until: endAt };
}

export function historyWindow(preferences, now = Date.now()) {
  if (preferences.timeMode === 'fixed')
    return parseHistoryRange(preferences.startAt, preferences.endAt);
  return { since: now - preferences.hours * 3600000, until: now };
}
