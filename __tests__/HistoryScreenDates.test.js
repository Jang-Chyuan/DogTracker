import { dayKey, dayBounds, availableDays, dateNavigation, calendarMonth, monthPicker, downloadTransition } from '../src/history/screen';
const today = '2026-10-08', local = ['2026-09-28', '2026-10-03'], cloud = ['2026-10-05'];
test('local keys and bounds use calendar days, navigation skips blank days and permits today', () => {
  expect(dayKey(new Date(2026, 9, 8))).toBe(today);
  expect(dayBounds(today).dayStart).toBe(new Date(2026, 9, 8).getTime());
  expect(dayBounds(today).dayEnd).toBe(new Date(2026, 9, 9).getTime());
  const days = availableDays(local, cloud);
  expect(dateNavigation('2026-10-03', today, days)).toEqual({ previous: '2026-09-28', next: '2026-10-05' });
  expect(dateNavigation('2026-10-05', today, days).next).toBe(today);
  expect(dateNavigation(today, today, days).next).toBe(null);
  expect(dateNavigation('2026-09-28', today, days).previous).toBe(null);
  expect(availableDays(local, cloud, 'local')).toEqual(local);
  expect(availableDays(local, cloud, 'cloud')).toEqual(cloud);
});
test('calendar spillover, local/cloud dots, future/blank disabled and today exception', () => {
  const model = calendarMonth(2026, 10, { today, selected: '2026-10-03', local, cloud });
  const cell = day => model.cells.find(d => d.day === day);
  expect(model.cells[0].day).toBe('2026-09-27');
  expect(cell('2026-09-28')).toMatchObject({ hasRecords: true, inMonth: false });
  expect(cell('2026-10-05')).toMatchObject({ cloudOnly: true, disabled: false });
  expect(cell(today)).toMatchObject({ today: true, disabled: false });
  expect(cell('2026-10-09').disabled).toBe(true);
  expect(cell('2026-10-04').disabled).toBe(true);
  expect(cell('2026-10-03').selected).toBe(true);
  expect(model.nextEnabled).toBe(false);
  expect(calendarMonth(2026, 9, { today, querying: true, fontScale: 2 })).toMatchObject({ layout: 'list', nextEnabled: true });
  expect(calendarMonth(2026, 10, { today, querying: true }).cells.find(d => d.day === '2026-10-04')).toMatchObject({ pending: true, disabled: false });
});
test('month picker restricts years, permits current month with no records', () => {
  const picker = monthPicker(2026, today, ['2025-02-01']);
  expect(picker).toMatchObject({ previousEnabled: true, nextEnabled: false });
  expect(picker.months[9].disabled).toBe(false);
  expect(picker.months[10].disabled).toBe(true);
  expect(monthPicker(2025, today, ['2025-02-01']).previousEnabled).toBe(false);
  expect(monthPicker(2025, today, ['2025-02-01']).months[1].hasRecords).toBe(true);
});
const initial = { day: today, status: 'ready', calendar: true };
const select = { type: 'select', day: '2026-10-05', cloudOnly: true, online: true, requestId: 'a' };
test('offline leaves original date/calendar; local selection requires no network', () => {
  expect(downloadTransition(initial, { ...select, online: false }).state).toMatchObject({ day: today, status: 'offline', calendar: true });
  expect(downloadTransition(initial, { ...select, cloudOnly: false }).effects).toEqual([]);
  expect(downloadTransition(initial, { ...select, disabled: true }).state).toBe(initial);
});
test.each(['cancel', 'failed', 'back', 'calendar', 'navigate'])('%s preserves selected day and partial records, ignores late completion', type => {
  const loading = downloadTransition(initial, select);
  expect(loading.effects[0]).toMatchObject({ type: 'download', requestId: 'a' });
  const result = downloadTransition(loading.state, { type, requestId: 'a' });
  expect(result.state).toMatchObject({ day: select.day, status: 'incomplete', message: '資料不完整　重試' });
  expect(downloadTransition(result.state, { type: 'complete', requestId: 'a' }).state).toBe(result.state);
  expect(downloadTransition(result.state, { type: 'retry', online: true, requestId: 'b' }).state.status).toBe('downloading');
});
test('request token protects new day and successful completion clears error', () => {
  const a = downloadTransition(initial, select).state;
  const b = downloadTransition(a, { ...select, day: '2026-09-28', requestId: 'b' });
  expect(b.effects.map(e => e.type)).toEqual(['cancel', 'download']);
  expect(downloadTransition(b.state, { type: 'complete', requestId: 'a' }).state).toBe(b.state);
  expect(downloadTransition(b.state, { type: 'complete', requestId: 'b' }).state.status).toBe('ready');
});
