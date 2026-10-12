import { replayVisitDecisions } from '../src/history/HistoryVisitReplay';
import { median } from '../src/history/HistoryConfig';

// Retained pre-optimization replay as an independent decision oracle. Inputs
// below are invented visit durations and relative clocks, never real packets.
function before(day, selected, config, following, judge) {
  const steps = [...new Set(day.flatMap(v => [v.start, v.end]))].sort((x, y) => x - y);
  let ready = false, fallback = null, typicalMs = null;
  for (const tick of steps) {
    const ownStarted = selected.filter(v => v.start <= tick).length;
    const useFallback = (!following && fallback) || ownStarted < config.minVisits;
    const base = useFallback ? day : selected;
    const started = base.filter(v => v.start <= tick).length;
    const typical = median(base.filter(v => v.completed && v.end <= tick).map(v => v.durationMs));
    if (started < config.minVisits || typical == null) continue;
    const switched = ready && fallback !== useFallback;
    typicalMs = typical;
    if (!ready || switched) judge(selected.filter(v => v.end <= tick && (v.completed || v.start <= tick)), typical);
    else judge(selected.filter(v => v.completed && v.end === tick), typical);
    ready = true; fallback = useFallback;
  }
  return { ready, fallback, typicalMs };
}
const config = { minVisits: 5, stayMs: 120000, stayRatio: 2 };
const visits = durations => {
  let time = 0;
  return durations.map((durationMs, i) => {
    const visit = { id: `invented:${i}`, start: time, end: time + durationMs, durationMs, completed: true };
    time = visit.end + (i % 3 === 1 ? 180000 : 30000);
    return visit;
  });
};
function run(replay, day, selected, following, rules = config) {
  const marked = new Set(), judgements = [];
  const state = replay(day, selected, rules, following, (list, typical) => {
    judgements.push({ ids: list.map(v => v.id), typical });
    for (const v of list) if (!marked.has(v.id) && v.durationMs >= rules.stayMs
      && v.durationMs >= typical * rules.stayRatio) marked.add(v.id);
  });
  return { state, judgements, marked: [...marked] };
}

test('exact baseline transitions, sticky fixed fallback, ties and ongoing visits retain ordered decisions', () => {
  const day = visits([0, 60000, 60000, 900000, 60000, 60000, 120000, 120000, 30000, 1800000, 60000, 0]);
  for (const following of [true, false]) {
    for (const selected of [day, day.slice(3), day.slice(4, 8), day.slice(10), [],
      day.map((v, i) => i === day.length - 1 ? { ...v, completed: false } : v),
      day.slice(2, 10).map((v, i) => i === 0 ? { ...v, start: v.start + 1, durationMs: v.durationMs - 1 }
        : i === 7 ? { ...v, end: v.end - 1, durationMs: v.durationMs - 1, completed: true } : v)])
      expect(run(replayVisitDecisions, day, selected, following)).toEqual(run(before, day, selected, following));
  }
});

test('repeated end/start ties preserve insertion order rather than the schedule order', () => {
  const day = visits([60000, 120000, 60000, 180000, 120000, 300000, 300000]);
  const selected = day.map((v, i) => i > 4 ? { ...v, end: day[6].end, durationMs: 300000 } : v);
  for (const following of [true, false])
    expect(run(replayVisitDecisions, day, selected, following)).toEqual(run(before, day, selected, following));
});

test('unusual pure-helper inputs retain the legacy median and step semantics', () => {
  const day = visits([60000, 60000, 60000, 900000, 60000, 300000]);
  for (const altered of [day.map((v, i) => i === 2 ? { ...v, durationMs: -0 } : v),
    day.map((v, i) => i === 3 ? { ...v, durationMs: NaN } : v), [...day].reverse(),
    day.map((v, i) => i === 1 ? { ...v, start: String(v.start), end: String(v.end) } : v)])
    expect(run(replayVisitDecisions, altered, altered, false)).toEqual(run(before, altered, altered, false));
});

test('ongoing started votes, absent clipped-end ticks and fixed fallback have observable guards', () => {
  const rules = { minVisits: 5, stayMs: 2, stayRatio: 2 };
  const ongoing = Array.from({ length: 5 }, (_, i) => ({ id: `ongoing:${i}`, start: i * 10,
    end: i === 4 ? 100 : i * 10 + 1, durationMs: i === 4 ? 60 : 1, completed: i !== 4 }));
  const result = run(replayVisitDecisions, ongoing, ongoing, true, rules);
  expect(result).toEqual(run(before, ongoing, ongoing, true, rules));
  expect(result.state).toEqual({ ready: true, fallback: false, typicalMs: 1 });
  const day = Array.from({ length: 6 }, (_, i) => ({ id: `clipped:${i}`, start: i * 10,
    end: i < 4 ? i * 10 + 1 : i === 4 ? 49 : 80, durationMs: i < 4 ? 1 : i === 4 ? 9 : 30, completed: true }));
  const selected = day.slice(0, 5).map((v, i) => i === 4 ? { ...v, end: 45, durationMs: 5 } : v);
  expect(run(replayVisitDecisions, day, selected, true, rules)).toEqual(run(before, day, selected, true, rules));
  expect(run(replayVisitDecisions, day, selected, true, rules).marked).toEqual([]);
  const switching = visits([10, 10, 10, 10, 100, 100, 100, 100, 100]);
  for (const following of [true, false]) {
    const next = run(replayVisitDecisions, switching, switching.slice(4), following, rules);
    expect(next).toEqual(run(before, switching, switching.slice(4), following, rules));
    expect(next.state.fallback).toBe(!following);
  }
});

test('nonfinite/coercible medians and odd overflow retain the original arithmetic without sanitizing', () => {
  const day = visits([1, 1, 1, 1, 1, 1, 1]);
  for (const duration of [Infinity, -Infinity, null, undefined, '10', -0, NaN, Number.MAX_VALUE]) {
    const altered = day.map(v => ({ ...v, durationMs: duration }));
    for (const following of [true, false])
      expect(run(replayVisitDecisions, altered, altered, following)).toEqual(run(before, altered, altered, following));
  }
  const huge = day.map(v => ({ ...v, durationMs: Number.MAX_VALUE }));
  expect(run(replayVisitDecisions, huge, huge, true).state.typicalMs).toBe(Infinity);
  const nan = day.map(v => ({ ...v, durationMs: NaN }));
  expect(run(replayVisitDecisions, nan, nan, true).state.ready).toBe(true);
});

test('prefix baseline work grows with visits, not with visits multiplied by every step', () => {
  // Count actual reads of visit start rather than assert a particular heap or
  // helper implementation. The old algorithm rescans all visits at each tick.
  const count = (replay, n) => {
    let reads = 0;
    const day = visits(Array.from({ length: n }, (_, i) => (1 + i % 7) * 30000)).map(v => ({ ...v,
      get start() { reads += 1; return v.start; } }));
    run(replay, day, day, true);
    return reads;
  };
  const small = count(replayVisitDecisions, 10), large = count(replayVisitDecisions, 40);
  expect(large).toBeLessThan(small * 6);
  expect(count(before, 40)).toBeGreaterThan(large * 4);
});
