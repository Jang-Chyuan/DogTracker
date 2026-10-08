import { normalizeHistoryRows } from '../HistorySources';

export const HISTORY_SOURCE_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'local', label: '這支手機收到的' },
  { id: 'cloud', label: '雲端' },
];

/** The row at the foot of a dog's panel: 「資料來源：全部 ›」 (c328). */
export function sourceLabel(source = 'all') {
  const option = HISTORY_SOURCE_OPTIONS.find(o => o.id === source) ?? HISTORY_SOURCE_OPTIONS[0];
  return `資料來源：${option.label} ›`;
}

/** Supply rows for one subject (or slave_id on shared raw rows). Availability
 * describes packets, including indoor/status packets, not just GPS fixes.
 * Empty sources remain selectable: the design keeps this row even in H8.
 * Cloud day metadata may advertise records not downloaded yet. */
export function multiSourcePicker(rows = [], { subject = 'dog', subjectId,
  dayStart = -Infinity, dayEnd = Infinity, source = 'all', cloudAvailable = false } = {}) {
  if (subject === 'phone') return { visible: false, options: [], selected: null, label: null };
  const day = normalizeHistoryRows(rows).filter(p => p.time >= dayStart && p.time < dayEnd
    && (subjectId == null || p.slave_id == null || String(p.slave_id) === String(subjectId)));
  const local = day.some(p => p.source === 'local' || p.source === 'ble');
  const cloud = cloudAvailable || day.some(p => p.source === 'cloud');
  const selected = HISTORY_SOURCE_OPTIONS.some(o => o.id === source) ? source : 'all';
  const options = HISTORY_SOURCE_OPTIONS.map(o => ({ ...o, available: o.id === 'all' ? local || cloud
    : o.id === 'local' ? local : cloud, enabled: true, selected: o.id === selected }));
  return { visible: true, title: '資料來源', options, selected,
    label: sourceLabel(selected) };
}

/** Immediate selection; preserve explicit empty source rather than silently
 * switching to a different stream on date/subject changes. */
export function selectMultiSource(picker, source) {
  const option = picker.options.find(o => o.id === source);
  if (!option) return picker;
  return { ...picker, selected: source, open: false,
    options: picker.options.map(o => ({ ...o, selected: o.id === source })),
    label: sourceLabel(source) };
}
