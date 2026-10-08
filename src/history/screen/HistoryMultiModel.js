import { historyTimeline } from '../HistoryTimeline';
import { summaryText } from '../HistoryText';
import { screenDayModel } from './HistoryScreenModel';
import { protagonist } from './HistoryScreenDogs';
import { screenCursor } from './HistoryScreenCursor';
import { historyMapPresentation, withAlpha } from './HistoryMapModel';
import { emptyState } from './HistoryScreenState';

/** Subjects contain { id, name, colour, subject?, rows, options? }. Rows are
 * already partitioned by subject, including midnight context. Recompute each
 * timeline against the SAME range; do not merge raw fixes across identities.
 * The screen shows only the protagonist's list; sections are also exposed
 * per subject for summary/export consumers. No clock, IO or React. */
export function multiDayModel(subjects, options) {
  const full = subjects.map(s => screenDayModel(s.rows || [], { ...options, ...s.options,
    subject: s.subject || 'dog' }));
  const hasRangeData = (model, range) => range
    ? model.dayPoints.some(p => p.time >= range.start && p.time <= range.end) : model.points.length > 0;
  let main = protagonist(subjects.map((s, i) => ({ ...s, hasData: hasRangeData(full[i], options.range) })), options.protagonist);
  const range = options.range ?? full[subjects.findIndex(s => s.id === main)]?.screenRange ?? null;
  const models = subjects.map((s, i) => {
    const subject = s.subject || 'dog';
    const model = range?.start != null && range?.end != null ? historyTimeline(s.rows || [], {
      ...options, ...s.options, subject, range: { start: range.start, end: range.end },
      manualRange: range.manual ? { start: range.start, end: range.following ? null : range.end } : null,
      following: !!range.following,
    }) : full[i];
    return { s, model, subject, hasData: model.points.length > 0 };
  });
  main = protagonist(models.map(({ s, hasData }) => ({ ...s, hasData })), main);
  const mainModel = models.find(({ s }) => s.id === main)?.model;
  const cursorTime = options.cursorTime ?? mainModel?.points[mainModel.points.length - 1]?.time ?? null;
  const presentations = models.map(({ s, model, subject, hasData }) => {
    const active = s.id === main;
    const cursor = screenCursor(model, cursorTime, { subject, action: 'shared' });
    const map = hasData ? historyMapPresentation(model, { color: s.colour, cursor }) : null;
    if (map && active) map.times = map.times.filter(marker => marker.end || marker.time <= cursorTime);
    if (map && !active) {
      map.times = [];
      map.lines = map.lines.filter(line => !line.dashed).map(line => ({ ...line,
        width: line.vehicle ? 2 : 3, color: withAlpha(s.colour, line.start >= cursorTime ? 0.2 : 0.5) }));
    }
    const empty = emptyState({ subject, today: options.today, name: s.name,
      dayRecords: model.dayRecords, rangeRecords: hasData, hasPoints: hasData });
    return { id: s.id, name: s.name, colour: s.colour, active, hasData, opacity: hasData ? 1 : 0.4,
      model, map, cursor, empty, summary: hasData ? { ...summaryText(model, { subject }),
        name: s.name, distanceM: model.distanceM } : { name: s.name, title: empty.text, detail: '沒有資料', distanceM: 0 } };
  });
  const active = presentations.find(s => s.active);
  return { protagonist: main, range, cursorTime, subjects: presentations,
    timeline: active?.model.nodes ?? [], summary: active?.summary ?? null,
    camera: presentations.flatMap(s => s.map?.camera ?? []),
    exportEnabled: presentations.some(s => s.hasData) };
}
