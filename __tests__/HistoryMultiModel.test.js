import { multiDayModel, multiSelection } from '../src/history/screen';
import { visitsFixture } from '../__fixtures__/HistoryLogicFixtures';
import { historyTimeline } from '../src/history/HistoryTimeline';
const minute = 60000;
const rows = (offset = 0) => [0, 1, 2, 3, 4, 5].map((n) => ({ time: n * minute + offset,
  latitude: 25 + n * 0.0001, longitude: 121, source: 'local', accuracy: 5 }));
const subjects = multiSelection([{ id: 'a', name: '小黑', hasData: true }, { id: 'b', name: '豆豆', hasData: true }]).dogs
  .map((s, i) => ({ ...s, rows: rows(i * minute) }));
const options = { dayStart: 0, dayEnd: 86400000, today: false, range: { start: minute, end: 4 * minute }, protagonist: 'a' };
test('shared range intersects individual observations; existing algorithms and summaries agree', () => {
  const result = multiDayModel(subjects, options);
  expect(result.subjects.map(s => s.model.points.map(p => p.time))).toEqual([[1, 2, 3, 4], [1, 2, 3, 4]].map(a => a.map(t => t * minute)));
  result.subjects.forEach(s => {
    const reference = historyTimeline(subjects.find(d => d.id === s.id).rows, { ...options, subject: 'dog' });
    expect(s.model.distanceM).toBe(reference.distanceM);
    expect(s.summary.distanceM).toBe(reference.distanceM);
  });
  expect(result.timeline).toBe(result.subjects[0].model.nodes);
  expect(result.camera).toHaveLength(8);
  expect(result.cursorTime).toBe(4 * minute);
  expect(result.subjects[1].map.times).toEqual([]);
  expect(result.subjects[1].map.lines.every(l => l.width === 3)).toBe(true);
});
test('protagonist switches list without changing shared range; empty subject never drawn', () => {
  const result = multiDayModel([...subjects, { id: 'c', name: '阿福', rows: [] }], { ...options, protagonist: 'b' });
  expect(result.timeline).toBe(result.subjects[1].model.nodes);
  expect(result.range).toBe(options.range);
  expect(result.subjects[2]).toMatchObject({ map: null, opacity: 0.4, summary: { detail: '沒有資料' } });
  expect(multiDayModel([...subjects, { id: 'c', rows: [] }], { ...options, protagonist: 'c' }).protagonist).toBe('a');
});
test('shared cursor past subject last fix holds stale position; before first fix hides cursor', () => {
  const result = multiDayModel(subjects, { ...options, range: { start: 0, end: 6 * minute }, cursorTime: 6 * minute });
  expect(result.subjects[0].cursor).toMatchObject({ stale: true, point: { time: 5 * minute } });
  expect(result.subjects[0].cursor.label[1]).toContain('這段沒資料');
  expect(multiDayModel(subjects, { ...options, range: { start: 0, end: 6 * minute }, cursorTime: 0 }).subjects[1].cursor.hidden).toBe(true);
});
test('no day data and empty range use H8 without export; phone and empty selection safe', () => {
  const empty = multiDayModel([{ id: 'a', name: '小黑', rows: [] }], options);
  expect(empty).toMatchObject({ protagonist: 'a', exportEnabled: false, camera: [], timeline: [] });
  expect(empty.summary.title).toBe('這天沒有小黑的紀錄');
  const clipped = multiDayModel(subjects, { ...options, range: { start: 10 * minute, end: 11 * minute } });
  expect(clipped.summary.title).toBe('這段時間沒有紀錄');
  expect(clipped.exportEnabled).toBe(false);
  expect(multiDayModel([], options).protagonist).toBe(null);
  const phone = multiDayModel([{ id: 'phone', name: '我的路線', subject: 'phone', colour: '#1A73E8', rows: rows() }], { ...options, range: undefined });
  expect(phone.summary.detail).toContain('走了');
});
test('independent stop numbering and gaps never bridge subjects or missing intervals', () => {
  const stationary = visitsFixture();
  const result = multiDayModel(subjects.map(s => ({ ...s, rows: stationary })), { ...options, range: { start: 0, end: 630000 } });
  expect(result.subjects.map(s => s.map.places.map(p => p.number))).toEqual([[1], [1]]);
  const gap = multiDayModel([{ ...subjects[0], rows: [rows()[0], { ...rows()[1], time: 10 * minute }] }], { ...options, range: { start: 0, end: 10 * minute } });
  expect(gap.subjects[0].map.lines).toEqual([]);
});
test('source selection recalculates eligibility, points and shared auto range', () => {
  const mixed = subjects.map((s, i) => ({ ...s, rows: s.rows.map(p => ({ ...p, source: i ? 'cloud' : 'local' })) }));
  const local = multiDayModel(mixed, { ...options, source: 'local', protagonist: 'b', range: undefined });
  expect(local.protagonist).toBe('a');
  expect(local.subjects[1]).toMatchObject({ hasData: false, map: null });
  const cloud = multiDayModel(mixed, { ...options, source: 'cloud', range: undefined });
  expect(cloud.protagonist).toBe('b');
  expect(cloud.range.start).toBeGreaterThanOrEqual(minute);
  expect(cloud.subjects[0].model.points).toEqual([]);
});
