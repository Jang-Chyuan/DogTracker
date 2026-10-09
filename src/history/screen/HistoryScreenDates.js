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
export function calendarMonth(year, month, { today, selected, local = [], cloud = [], source = 'all', querying = false, fontScale = 1 }) {
  const days = availableDays(local, cloud, source);
  const first = new Date(year, month - 1, 1), start = new Date(year, month - 1, 1 - first.getDay());
  const count = Math.ceil((first.getDay() + new Date(year, month, 0).getDate()) / 7) * 7;
  const cells = Array.from({ length: count }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), day = dayKey(date);
    const hasRecords = days.includes(day);
    return { day, inMonth: date.getMonth() === month - 1, hasRecords,
      cloudOnly: hasRecords && !local.includes(day), disabled: day > today || (!hasRecords && day !== today && !querying),
      pending: querying && !hasRecords && day <= today, today: day === today, selected: day === selected };
  });
  return { cells, layout: fontScale >= 2 ? 'list' : 'grid', querying,
    nextEnabled: `${year}-${pad(month)}` < today.slice(0, 7), returnTodayEnabled: selected !== today };
}
export function monthPicker(year, today, days) {
  const earliestYear = Number(days[0]?.slice(0, 4) ?? today.slice(0, 4));
  return { previousEnabled: year > earliestYear, nextEnabled: year < Number(today.slice(0, 4)),
    months: Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${pad(i + 1)}`, hasRecords = days.some(d => d.startsWith(key));
      return { month: i + 1, hasRecords, disabled: key > today.slice(0, 7) || (!hasRecords && key !== today.slice(0, 7)) };
    }) };
}

/** Request tokens make late completion after cancel/date change harmless.
 * Effects are descriptors for the caller, never network operations. */
export function downloadTransition(state, event) {
  if (event.type === 'select') {
    if (event.disabled) return { state, effects: [] };
    const cancel = state.status === 'downloading' ? [{ type: 'cancel', requestId: state.requestId }] : [];
    if (event.cloudOnly && !event.online) return { state: { ...state, status: 'offline', calendar: true,
      message: `沒有網路，${Number(event.day.slice(5, 7))}/${Number(event.day.slice(8))} 的紀錄還沒下載，連上網路再試` }, effects: cancel };
    return { state: { ...state, day: event.day, calendar: false, status: event.cloudOnly ? 'downloading' : 'ready',
      requestId: event.requestId, message: null }, effects: [...cancel, ...(event.cloudOnly ? [{ type: 'download', day: event.day, requestId: event.requestId }] : [])] };
  }
  if (event.type === 'retry') return downloadTransition(state, { ...event, type: 'select', day: state.day, cloudOnly: true });
  if (state.status !== 'downloading') return { state, effects: [] };
  if (['complete', 'failed'].includes(event.type) && event.requestId !== state.requestId) return { state, effects: [] };
  if (event.type === 'complete') return { state: { ...state, status: 'ready', message: null }, effects: [] };
  if (['cancel', 'failed', 'back', 'calendar', 'navigate'].includes(event.type)) return {
    state: { ...state, status: 'incomplete', message: '資料不完整　重試', calendar: event.type === 'calendar' },
    effects: event.type === 'failed' ? [] : [{ type: 'cancel', requestId: state.requestId }],
  };
  return { state, effects: [] };
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
/** The date row (H3a): 「10/03（六）今天」, another day 「9/28（一）」. */
export function dateRowLabel(dayStart, todayStart) {
  const at = new Date(dayStart);
  const text = `${at.getMonth() + 1}/${pad(at.getDate())}（${WEEKDAYS[at.getDay()]}）`;
  return dayStart === todayStart ? `${text}今天` : text;
}
