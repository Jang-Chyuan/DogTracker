// 2026-10-13: what a sweep of the history list found (invented places, times
// and rows only). The minute-accounting shapes are in PhoneMinuteAccounting.
import { t } from '../src/i18n';
import { listDuration, nodePill, nodeTimes } from '../src/history/HistoryText';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { historyIndoorNodes } from '../src/history/HistoryStops';
import { historyDeparture } from '../src/history/HistoryDeparture';
import { point } from '../__fixtures__/HistoryLogicFixtures';

const MINUTE = 60000;
const T0 = new Date(2026, 0, 5, 7, 0).getTime();

describe('a merged stay of no minutes says no 「停 0 分」', () => {
  const stay = (start, end) => ({ type: 'stop', number: 1, start, end, durationMs: end - start,
    latitude: 24.9, longitude: 121.3, gaps: [] });

  test('出發 merged with 20 s of a stay (a manual range starting at its end) is 「出發」', () => {
    const shown = timelinePresentation([{ type: 'departure', start: T0, end: T0, latitude: 24.9, longitude: 121.3, manual: true },
      stay(T0, T0 + 20000), { type: 'movement', mode: 'walking', start: T0 + 20000, end: T0 + 5 * MINUTE,
        durationMs: 5 * MINUTE - 20000, distanceM: 300, countedDistanceM: 300 }]);
    expect(shown[0].departureStay).toBeTruthy();
    expect(nodePill(shown[0]).text).toBe(t('c124'));
  });

  test('the end merged with such a stay is 「結束」; a stay of its own is 「停 不到 1 分」', () => {
    const end = { type: 'end', start: T0 + 20000, end: T0 + 20000, label: t('c330'), terminalStay: stay(T0, T0 + 20000) };
    expect(nodePill(end).text).toBe(t('c330'));
    expect(nodePill(stay(T0, T0 + 20000)).text).toBe(t('c127', { duration: t('c1276') }));
    // A minute or more: as before.
    expect(nodePill({ ...end, terminalStay: stay(T0, T0 + 2 * MINUTE) }).text)
      .toBe(`${t('c330')} · ${t('c127', { duration: listDuration(2 * MINUTE) })}`);
  });
});

describe('a hold carried over midnight keeps one place on both days', () => {
  const dayEnd = new Date(2026, 0, 6).getTime();
  const held = (time, north, since) => point(0, north, { time, heldReason: 'indoor', heldSince: since, locationTime: null });

  test('the day before shows it where it was held at midnight, where the next day\'s 「接續前一天」 begins', () => {
    const since = dayEnd - 5 * 3600000;
    // Good fixes inside refined the anchor 30 m north two hours in.
    const points = [];
    for (let time = since; time < dayEnd + 3 * MINUTE; time += MINUTE) {
      points.push(held(time, time < since + 2 * 3600000 ? 0 : 30, since));
    }
    const [before] = historyIndoorNodes(points, { start: since, end: dayEnd - 1, dayStart: dayEnd - 86400000, dayEnd: dayEnd - 1 });
    expect(before.continuesNextDay).toBe(true);
    const [next] = historyIndoorNodes(points, { start: dayEnd, end: dayEnd + 3 * MINUTE, dayStart: dayEnd, dayEnd: dayEnd + 86400000 - 1 });
    expect(next.continuesPreviousDay).toBe(true);
    expect({ latitude: before.latitude, longitude: before.longitude })
      .toEqual({ latitude: next.latitude, longitude: next.longitude });
    // A hold that ends that day keeps the place where it began.
    const [ended] = historyIndoorNodes(points.filter(p => p.time < dayEnd - 30 * MINUTE),
      { start: since, end: dayEnd - 1, dayStart: dayEnd - 86400000, dayEnd: dayEnd - 1 });
    expect(ended.latitude).toBe(points[0].latitude);
  });
});

test('a dog heard all day without a fix lists 「收不到 GPS」, not 「這段時間沒有紀錄」', () => {
  const dayStart = T0 - 7 * 3600000;
  const rows = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * MINUTE, latitude: null, longitude: null }));
  const model = historyTimeline(rows, { subject: 'dog', dayStart, dayEnd: dayStart + 86400000, replayHolds: packets => packets });
  expect(model.dayRecords).toBe(true);
  expect(model.points).toEqual([]);
  expect(model.nodes).toEqual([expect.objectContaining({ type: 'gap', reason: 'no-gps', start: T0, end: T0 + 59 * MINUTE })]);
  // Nothing to draw: no section with a coordinate for the map.
  expect(model.sections).toEqual([]);
  // A day with nothing at all is still H8.
  expect(historyTimeline([], { subject: 'dog', dayStart, dayEnd: dayStart + 86400000 }).nodes).toEqual([]);
});

test('出發 is where the walk began, not a fix of the stay three minutes before it', () => {
  // A dog at a stay from 07:00 (3 m jitter, a fix every 10 s), walking off at
  // 07:12 at 1.4 m/s.
  const rows = [];
  for (let s = 0; s < 12 * 60; s += 10) rows.push(point(s, s % 20 ? 3 : 0));
  for (let s = 12 * 60, m = 0; s <= 30 * 60; s += 10) { m += 14; rows.push(point(s, m)); }
  const found = historyDeparture(rows, { subject: 'dog' });
  expect(found.status).toBe('confirmed');
  expect(found.automaticRange.start).toBeGreaterThanOrEqual(11 * MINUTE + 40000);
  expect(found.automaticRange.start).toBeLessThanOrEqual(12 * MINUTE);
});

test('a day that begins indoors: the 室內 row starts where the range does', () => {
  const departure = { type: 'departure', start: T0, end: T0, latitude: 24.9, longitude: 121.3 };
  const hold = { type: 'indoor', start: T0 + 40000, end: T0 + 40 * MINUTE, latitude: 24.9, longitude: 121.3 };
  const shown = timelinePresentation([departure, { type: 'movement', mode: 'moving', start: T0, end: T0 + 40000,
    durationMs: 40000, distanceM: 0, countedDistanceM: 0 }, hold]);
  expect(shown.map(n => n.type)).toEqual(['indoor']);
  expect(nodeTimes(shown[0])[0]).toBe(nodeTimes(departure)[0]);
  expect(shown[0].start).toBe(T0);
});

test('a stationary run that settles a few seconds after the first fix is the 出發\'s stay, not a second row at that minute', () => {
  const departure = { type: 'departure', start: T0, end: T0, latitude: 1, longitude: 1 };
  const run = { type: 'stop', presentationOnly: 'phone-stationary', number: null, start: T0 + 20000, end: T0 + 30 * MINUTE,
    durationMs: 30 * MINUTE - 20000, interruptionMs: 0, gaps: [], latitude: 1, longitude: 1 };
  const shown = timelinePresentation([departure, run, { type: 'end', start: T0 + 31 * MINUTE, end: T0 + 31 * MINUTE,
    label: t('c330'), latitude: 1, longitude: 1.0001 }]);
  // (The still minute before the end is that stay's too: every minute has a row.)
  expect(shown[0]).toMatchObject({ type: 'departure', start: T0, end: T0 + 31 * MINUTE });
  expect(nodePill(shown[0]).text).toBe(`${t('c124')} · ${t('c127', { duration: listDuration(31 * MINUTE) })}`);
});
