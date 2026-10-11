import { createHistoryReadDiagnostics } from '../src/diagnostics/HistoryReadDiagnostics';
import { historyModelDiagnostic, HISTORY_MODEL_STAGES } from '../src/logger';
import { multiDayModel, multiCursors, multiMapPresentation } from '../src/history/screen/HistoryMultiModel';
import { dogHistoryRow } from '../src/history/HistoryRows';
import { createHistoryHolds } from '../src/placement/IndoorHold';

const payloads = spy => spy.mock.calls.filter(args => args[0] === '[HistoryModel]').map(args => args[1]);

test('model diagnostic reconstructs only a fixed stage, sequence, duration and aggregate count', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const safe = { sequence: 1, stage: 'replay', elapsedMs: 4, inputCount: 20 };
  try {
    historyModelDiagnostic({ ...safe, dog: 6, owner: 'private', time: 999, coordinates: [1, 2], error: new Error('private') });
    expect(payloads(spy)).toEqual([safe]); spy.mockClear();
    for (const invalid of [{ sequence: 0 }, { stage: 'private' }, { inputCount: -1 }, { inputCount: 1.5 },
      { inputCount: 'private' }, { elapsedMs: Infinity }, { elapsedMs: NaN }, { elapsedMs: -1 }])
      historyModelDiagnostic({ ...safe, ...invalid });
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('bounded model stages do not retry operations, swallow product errors or leak sink/clock failures', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  let time = 0;
  const diagnostic = createHistoryReadDiagnostics(() => time);
  const value = {}, operation = jest.fn(() => { time += 3; return value; });
  try {
    for (let i = 0; i < 20; i++) expect(diagnostic.measure('replay', 4, operation)).toBe(value);
    expect(operation).toHaveBeenCalledTimes(20);
    expect(payloads(spy)).toHaveLength(2);
    expect(payloads(spy).map(p => p.elapsedMs)).toEqual([3, 3]);
    const error = new Error('product');
    expect(() => diagnostic.measure('stops', 4, () => { throw error; })).toThrow(error);
    spy.mockImplementation(() => { throw new Error('sink'); });
    expect(diagnostic.measure('filter', 4, () => value)).toBe(value);
    let refuse = false;
    const refusedClock = createHistoryReadDiagnostics(() => { if (refuse) throw new Error('clock'); return 0; });
    refuse = true;
    const once = jest.fn(() => value);
    expect(refusedClock.measure('stream', 4, once)).toBe(value);
    expect(once).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

test('production pipeline with fresh hold replay and measured cursors/map preserves complete model and raw inputs', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  // Independently invented relative clocks, 40 observations: walk, poor GPS
  // hold, then a distinct valid departure. Not sampled/transformed real data.
  const day = 86400000;
  const rows = Array.from({ length: 40 }, (_, i) => dogHistoryRow({ id: i + 1, slave_id: 41,
    track_at: day + i * 30000, received_at: day + i * 30000,
    slave_lat: 20 + Math.min(i, 10) * 0.00005 + (i > 28 ? (i - 28) * 0.00008 : 0),
    slave_lon: 100, satellites: i > 10 && i < 29 ? 3 : 9, hdop: i > 10 && i < 29 ? 6 : 1,
    speed_kmh: i > 10 && i < 29 ? 0 : 4 }, 'cloud'));
  const original = rows.map(row => ({ ...row }));
  const make = () => {
    const pass = createHistoryHolds();
    return [{ id: 41, rows, replayHolds: packets => { pass.append(packets); return pass.output; } }];
  };
  const options = { dayStart: day, dayEnd: day + 86400000, today: false, protagonist: 41 };
  try {
    const expected = multiDayModel(make(), options);
    const diagnostic = createHistoryReadDiagnostics();
    const measured = multiDayModel(make(), { ...options, measure: diagnostic.measure });
    expect(measured).toEqual(expected);
    expect(rows).toEqual(original);
    const time = measured.range.end;
    const cursors = diagnostic.measure('cursors', 1, () => multiCursors(measured, time));
    const expectedCursors = multiCursors(expected, time);
    expect(cursors).toEqual(expectedCursors);
    const look = { 41: { color: '#1976D2', name: 'Invented QA' } };
    expect(diagnostic.measure('map-presentation', measured.main.points.length,
      () => multiMapPresentation(measured, cursors, look)))
      .toEqual(multiMapPresentation(expected, expectedCursors, look));
    const events = payloads(spy);
    expect(new Set(events.map(p => p.stage))).toEqual(new Set(HISTORY_MODEL_STAGES.filter(s => s !== 'model-to-effect')));
    expect(events.find(p => p.stage === 'stream').inputCount).toBe(40);
    expect(events.find(p => p.stage === 'replay').inputCount).toBe(40);
    expect(events.every(p => Number.isFinite(p.elapsedMs) && p.elapsedMs >= 0)).toBe(true);
  } finally { spy.mockRestore(); }
});
