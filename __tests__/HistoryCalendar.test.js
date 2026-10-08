import {
  calendarMonth, chooseDay, dayCell, dayState, daysBetween, downloadPanel, earliestKnownDay, knownDays, monthPicker,
  monthQueryRange, monthsToCheck, offlineMessage, shiftMonth, shortDate, walkCloudDays,
} from '../src/history/screen/HistoryCalendar';
import { dayBounds } from '../src/history/screen/HistoryScreenDates';

const today = '2026-10-07';
// This phone: 9/29, 9/30, 10/2, today; the cloud: those and 9/28, 10/3.
const known = {
  local: ['2026-09-29', '2026-09-30', '2026-10-02', today],
  cloud: ['2026-09-28', '2026-09-29', '2026-10-03'],
  checked: [], cloudEnabled: true, query: 'idle', earliest: '2026-08-12',
};
const checkedOctober = { ...known, checked: daysBetween(dayBounds('2026-09-27').dayStart, dayBounds(today).dayEnd) };

test('the H3b month: September\'s last days first, dots for local and cloud days alike, grey for empty and future', () => {
  const view = calendarMonth({ year: 2026, month: 10, today, selected: '2026-10-03', knowledge: checkedOctober });
  expect(view.title).toBe('2026 年 10 月');
  expect(view.cells[0]).toMatchObject({ day: '2026-09-27', inMonth: false, muted: true, tappable: false });
  expect(view.weeks).toHaveLength(5);
  const cell = day => view.cells.find(c => c.day === day);
  expect(cell('2026-09-28')).toMatchObject({ state: 'cloud', dot: true, inMonth: false, tappable: true });
  expect(cell('2026-09-29')).toMatchObject({ state: 'local', dot: true });
  expect(cell('2026-10-01')).toMatchObject({ state: 'empty', dot: false, muted: true, tappable: false,
    label: '10 月 1 日，沒有紀錄' });
  expect(cell('2026-10-03')).toMatchObject({ selected: true, state: 'cloud' });
  expect(cell(today)).toMatchObject({ today: true, tappable: true, dot: true });
  expect(cell('2026-10-08')).toMatchObject({ state: 'future', muted: true, tappable: false });
  expect(view).toMatchObject({ previousEnabled: true, nextEnabled: false, returnTodayEnabled: true, status: null });
  expect(calendarMonth({ year: 2026, month: 10, today, selected: today, knowledge: checkedOctober }).returnTodayEnabled)
    .toBe(false);
});

test('today is always tappable, even without records', () => {
  const view = calendarMonth({ year: 2026, month: 10, today, selected: '2026-10-02',
    knowledge: { local: ['2026-10-02'], cloudEnabled: false } });
  expect(view.cells.find(c => c.day === today)).toMatchObject({ today: true, dot: false, tappable: true, muted: false,
    label: '10 月 7 日，今天，沒有紀錄' });
  expect(chooseDay(today, { today, knowledge: { local: [] } })).toEqual({ type: 'show', day: today });
});

test('while the cloud is asked unknown days wait in normal colour; after a failure they can be tapped', () => {
  const querying = { ...known, query: 'querying' };
  const cell = dayCell('2026-10-05', { today, selected: today, knowledge: querying });
  expect(cell).toMatchObject({ state: 'unknown', muted: false, tappable: false });
  expect(calendarMonth({ year: 2026, month: 10, today, selected: today, knowledge: querying }).status).toBe('querying');
  const failed = { ...known, query: 'failed' };
  expect(dayCell('2026-10-05', { today, selected: today, knowledge: failed })).toMatchObject({ tappable: true, muted: false });
  expect(chooseDay('2026-10-05', { today, knowledge: failed })).toEqual({ type: 'download', day: '2026-10-05' });
  // Days before the cloud's earliest are known to be empty.
  expect(dayState('2026-08-01', today, known)).toBe('empty');
  // Signed out: only this phone counts, everything else is empty.
  expect(dayState('2026-10-03', today, { ...known, cloudEnabled: false })).toBe('empty');
});

test('choosing a day: this phone shows it, the cloud downloads it, offline stays with H3d\'s words', () => {
  expect(chooseDay('2026-09-29', { today, knowledge: checkedOctober })).toEqual({ type: 'show', day: '2026-09-29' });
  expect(chooseDay('2026-09-28', { today, knowledge: checkedOctober })).toEqual({ type: 'download', day: '2026-09-28' });
  expect(chooseDay('2026-09-28', { today, knowledge: checkedOctober, online: false })).toEqual({ type: 'offline',
    day: '2026-09-28', message: '沒有網路，9/28 的紀錄還沒下載，連上網路再試' });
  expect(chooseDay('2026-10-01', { today, knowledge: checkedOctober })).toEqual({ type: 'none' });
  expect(chooseDay('2026-10-08', { today, knowledge: checkedOctober })).toEqual({ type: 'none' });
  expect(offlineMessage('2026-10-03')).toBe('沒有網路，10/03 的紀錄還沒下載，連上網路再試');
  expect(shortDate('2026-09-28')).toBe('9/28');
});

test('‹ › of the month: down to the earliest known month, never past this month; nothing known: only this month', () => {
  expect(calendarMonth({ year: 2026, month: 8, today, selected: today, knowledge: known })).toMatchObject({
    previousEnabled: false, nextEnabled: true });
  expect(calendarMonth({ year: 2026, month: 10, today, selected: today, knowledge: { cloudEnabled: true } }))
    .toMatchObject({ previousEnabled: false, nextEnabled: false });
  expect(earliestKnownDay(known)).toBe('2026-08-12');
  expect(earliestKnownDay({ ...known, cloudEnabled: false })).toBe('2026-09-29');
  expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  expect(shiftMonth({ year: 2025, month: 12 }, 1)).toEqual({ year: 2026, month: 1 });
});

test('H3e: months with records have a dot, empty and future months are grey, this month always tappable', () => {
  // The cloud checked January–July (nothing) and found August.
  const knowledge = { ...known, checked: daysBetween(dayBounds('2026-01-01').dayStart, dayBounds('2026-08-01').dayStart) };
  const picker = monthPicker({ year: 2026, today, shown: '2026-10', knowledge });
  expect(picker.title).toBe('2026 年');
  expect(picker.months.map(m => m.state)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty',
    'records', 'records', 'records', 'future', 'future']);
  // August: the cloud's earliest day (8/12) holds rows.
  expect(picker.months[9]).toMatchObject({ dot: true, selected: true, tappable: true });
  expect(picker.months[10]).toMatchObject({ muted: true, tappable: false });
  expect(picker).toMatchObject({ previousEnabled: false, nextEnabled: false });
  // A month not asked about yet: normal colour, tappable.
  const open = monthPicker({ year: 2026, today, knowledge: { ...known, earliest: null } });
  expect(open.months[6]).toMatchObject({ state: 'unknown', tappable: true, muted: false, dot: false });
  expect(monthsToCheck(2026, today, { ...known, earliest: null })).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(monthsToCheck(2026, today, known)).toEqual([]);
  // This month without any record is still tappable.
  const empty = monthPicker({ year: 2026, today, knowledge: { cloudEnabled: false } });
  expect(empty.months[9]).toMatchObject({ state: 'empty', tappable: true, muted: false });
  expect(empty.months[8]).toMatchObject({ state: 'empty', tappable: false, muted: true });
  expect(monthPicker({ year: 2025, today, knowledge: { local: ['2025-03-02'] } }))
    .toMatchObject({ previousEnabled: false, nextEnabled: true });
});

test('the date row steps between this phone\'s days and the cloud days found', () => {
  expect(knownDays(known)).toEqual(['2026-08-12', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-02', '2026-10-03', today]);
  expect(knownDays({ ...known, cloudEnabled: false })).toEqual(known.local);
});

test('a month asks the cloud about its weeks up to the end of today', () => {
  const range = monthQueryRange({ year: 2026, month: 10 }, today);
  expect(range.since).toBe(dayBounds('2026-09-27').dayStart);
  expect(range.until).toBe(dayBounds(today).dayEnd);
  expect(daysBetween(range.since, range.until)).toHaveLength(11);
  expect(daysBetween(5, 5)).toEqual([]);
});

test('the cloud walk finds each day with rows and the empty days between, newest first', async () => {
  const at = (day, hour) => dayBounds(day).dayStart + hour * 3600000;
  const rows = [at('2026-09-28', 10), at('2026-09-28', 15), at('2026-10-03', 9), at(today, 8)];
  const asked = [];
  const newestBefore = async (cutoff, since) => {
    asked.push(cutoff);
    return rows.filter(t => t >= since && t < cutoff).sort((a, b) => b - a)[0] ?? null;
  };
  const steps = [];
  const { since, until } = monthQueryRange({ year: 2026, month: 10 }, today);
  const found = await walkCloudDays({ newestBefore, since, until, onStep: step => steps.push(step) });
  expect(found).toEqual([today, '2026-10-03', '2026-09-28']);
  expect(asked).toHaveLength(4);
  expect(steps[0]).toEqual({ found: today, checked: [today] });
  expect(steps[1]).toEqual({ found: '2026-10-03', checked: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'] });
  expect(steps[3]).toEqual({ found: null, checked: ['2026-09-27'] });
  const all = steps.flatMap(step => step.checked);
  expect(new Set(all).size).toBe(11);
  // Stopped (another month, the sheet closed): nothing more is reported.
  const late = [];
  await walkCloudDays({ newestBefore, since, until, onStep: step => late.push(step), isCurrent: () => false });
  expect(late).toEqual([]);
});

test('H3c and its cancelled or failed ends', () => {
  const day = '2026-09-28';
  expect(downloadPanel({ day, status: 'downloading' }, { day, hasRows: false })).toEqual({ kind: 'downloading',
    title: '下載 9/28 的紀錄…', detail: '只有雲端有，正在下載', action: '取消' });
  expect(downloadPanel({ day, status: 'failed' }, { day, hasRows: false })).toEqual({ kind: 'unfinished',
    text: '這天的紀錄還沒下載完', action: '重試' });
  expect(downloadPanel({ day, status: 'cancelled' }, { day, hasRows: true })).toEqual({ kind: 'incomplete',
    text: '資料不完整', action: '重試' });
  expect(downloadPanel({ day, status: 'done' }, { day, hasRows: true })).toBe(null);
  expect(downloadPanel({ day, status: 'downloading' }, { day: today, hasRows: true })).toBe(null);
  expect(downloadPanel(null, { day, hasRows: true })).toBe(null);
});
