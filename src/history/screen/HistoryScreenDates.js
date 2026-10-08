// Day keys are local YYYY-MM-DD; compare keys, never parse them as UTC dates.
const pad = n => String(n).padStart(2, '0');
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function dayBounds(day) {
  const [y, m, d] = day.split('-').map(Number);
  return { dayStart: new Date(y, m - 1, d).getTime(), dayEnd: new Date(y, m - 1, d + 1).getTime() };
}
export function availableDays(local = [], cloud = [], source = 'all') {
  return [...new Set(source === 'local' ? local : source === 'cloud' ? cloud : [...local, ...cloud])].sort();
}
export function dateNavigation(day, today, days) {
  return { previous: days.filter(d => d < day && d <= today).pop() ?? null,
    next: day >= today ? null : days.find(d => d > day && d <= today) ?? today };
}
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
/** The date row (H3a): 「10/03（六）今天」, another day 「9/28（一）」. */
export function dateRowLabel(dayStart, todayStart) {
  const at = new Date(dayStart);
  const text = `${at.getMonth() + 1}/${pad(at.getDate())}（${WEEKDAYS[at.getDay()]}）`;
  return dayStart === todayStart ? `${text}今天` : text;
}
