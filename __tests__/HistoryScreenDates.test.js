import { dayKey, dayBounds, availableDays, dateNavigation } from '../src/history/screen';
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
  expect(availableDays([...local, ...cloud], cloud)).toEqual(days);
});
