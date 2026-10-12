import { historyTimeline } from '../src/history/HistoryTimeline';

// Invented five-second walk: 1.4 m/s for 5 min, a pause, 1.4 m/s for 5 min.
const base = 1600000000000;
const row = (seconds, metres, moving, state) => ({ time: base + seconds * 1000,
  latitude: 1, longitude: 1 + metres / 111320, raw_latitude: 1, raw_longitude: 1 + metres / 111320,
  accuracy: 4, raw_speed_kmh: moving ? 5.04 : 0, speed_kmh: moving ? 5.04 : 0, speed_accuracy_mps: 0.4,
  motion_state: state, session_id: 'fiction-walk' });
const walk = pause => {
  const rows = [];
  for (let s = 0; s <= 300; s += 5) rows.push(row(s, s * 1.4, true, 'moving'));
  for (let s = 305; s < 300 + pause; s += 5)
    rows.push(row(s, 420, false, s - 300 >= 20 ? 'stationary' : 'suspected_stationary'));
  for (let s = 300 + pause; s <= 600 + pause; s += 5) rows.push(row(s, 420 + (s - 300 - pause) * 1.4, true, 'moving'));
  return rows;
};
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
  manualRange: { start: rows[0].time, end: rows.at(-1).time } });
const rowsOf = model => model.nodes.filter(n => ['movement', 'gap', 'stop', 'indoor'].includes(n.type));

test.each([40, 90])('a %i s red light mid-walk is 0 m time of one walk row, not a hole between two', pause => {
  const model = timeline(walk(pause));
  const rows = rowsOf(model);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ type: 'movement', mode: 'walking', start: base, end: base + (600 + pause) * 1000,
    durationMs: (600 + pause) * 1000 });
  // The pause adds no distance.
  const walked = model.edges.filter(e => !e.from.phoneStationary || !e.to.phoneStationary)
    .reduce((sum, e) => sum + e.countedDistanceM, 0);
  expect(rows[0].countedDistanceM).toBeCloseTo(walked, 6);
});

test('a pause of a stay length keeps its own stay row; the walk rows around it are not stretched over it', () => {
  const rows = rowsOf(timeline(walk(240)));
  expect(rows.map(n => n.type)).toEqual(['movement', 'stop', 'movement']);
  // Rows meet: the minutes add up to the range, nothing counted twice.
  for (let i = 1; i < rows.length; i++) expect(rows[i].start).toBe(rows[i - 1].end);
  expect(rows.at(-1).end - rows[0].start).toBe(840000);
});

test('a short pause next to a recording gap is not bridged into walking', () => {
  const rows = walk(40);
  // Nothing saved for 10 min after the pause; the walk resumes 600 m on.
  const later = rows.filter(r => r.time > base + 330000).map(r => ({ ...r, time: r.time + 10 * 60000,
    longitude: r.longitude + 600 / 111320, raw_longitude: r.raw_longitude + 600 / 111320 }));
  const model = timeline([...rows.filter(r => r.time <= base + 330000), ...later]);
  expect(rowsOf(model).some(n => n.type === 'gap')).toBe(true);
  for (const walkRow of rowsOf(model).filter(r => r.type === 'movement')) {
    expect(model.nodes.some(g => g.type === 'gap' && g.start < walkRow.end && g.end > walkRow.start)).toBe(false);
  }
});
