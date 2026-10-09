import { historyTimeline } from '../src/history';
import { clock, nodePill, summaryText } from '../src/history/HistoryText';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { pngTitle } from '../src/mapHistory/ExportPNG';
import { point } from '../__fixtures__/HistoryLogicFixtures';

const summary = model => summaryText(model, { subject: 'phone' });

test('past day without departure shows the entire recorded day', () => {
  const start = new Date(2026, 9, 8, 7, 2).getTime();
  const end = new Date(2026, 9, 8, 18, 30).getTime();
  const model = historyTimeline([point(0), point(0)].map((p, i) => ({ ...p, time: i ? end : start })),
    { subject: 'phone' });
  expect(model.departure.status).toBe('undetermined');
  expect(summary(model).title).toBe('07:02 – 18:30');
  expect(summary(model).detail).toMatch(/^走了 /);
  expect(nodePill(model.nodes[0])).toEqual({ text: '出發', tone: 'plain' });
});

test('a failed tentative departure returns the title to the whole-day range', () => {
  const rows = Array.from({ length: 49 }, (_, i) => point(i * 10, i <= 6 ? 0 : i <= 27 ? (i - 6) * 10 : 0));
  const tentative = historyTimeline(rows, { subject: 'phone', today: true, now: 300000 });
  expect(tentative.departure.status).toBe('confirming');
  expect(summary(tentative).title).toBe(`${clock(tentative.departure.range.start)} – 現在`);
  const failed = historyTimeline(rows, { subject: 'phone', today: true, now: 960000 });
  expect(failed.departure.status).toBe('not-departed');
  expect(summary(failed).title).toBe(`${clock(rows[0].time)} – 最後 ${clock(rows[48].time)}`);
});

test('today without departure keeps the stale-last-record ending', () => {
  const rows = [point(0), point(60)];
  const model = historyTimeline(rows, { subject: 'phone', today: true, now: 240000 });
  expect(model.departure.status).toBe('not-departed');
  expect(summary(model).title).toBe(`${clock(rows[0].time)} – 最後 ${clock(rows[1].time)}`);
});

test('PNG title for a day without departure uses actual record times', () => {
  const start = new Date(2026, 9, 8, 7, 2).getTime();
  const end = new Date(2026, 9, 8, 18, 30).getTime();
  const model = historyTimeline([point(0), point(0)].map((p, i) => ({ ...p, time: i ? end : start })),
    { subject: 'phone' });
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
    range: { start, end }, subject: 'phone' });
  const title = pngTitle(snapshot, snapshot.subjects);
  expect(title.title).toBe('DogTracker・我的路線');
  expect(title.subtitle).toContain('07:02–18:30・走了 0.0 km');
});
