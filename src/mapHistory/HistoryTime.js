const pad = value => String(value).padStart(2, '0');
export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function parseHistoryStart(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || ''))
    throw new Error('請選擇日期，並輸入開始時間 HH:mm，例如 08:30');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const start = new Date(year, month - 1, day, hour, minute);
  if (year < 2000 || year > 2100 || start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day || start.getHours() !== hour || start.getMinutes() !== minute)
    throw new Error('日期或開始時間無效');
  return start.getTime();
}
export function historyWindow(preferences, now = Date.now()) {
  const duration = preferences.hours * 3600000;
  const since = preferences.timeMode === 'fixed'
    ? parseHistoryStart(preferences.startDate, preferences.startTime) : now - duration;
  return { since, until: preferences.timeMode === 'fixed' ? since + duration : now };
}
