import { median } from './HistoryConfig';

const lowerFirst = (a, b) => a > b;
const upperFirst = (a, b) => a < b;
function push(heap, value, before) {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!before(value, heap[parent])) break;
    heap[index] = heap[parent]; index = parent;
  }
  heap[index] = value;
}
function pop(heap, before) {
  const first = heap[0], last = heap.pop();
  if (!heap.length) return first;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child += 1;
    if (!before(heap[child], last)) break;
    heap[index] = heap[child]; index = child;
  }
  heap[index] = last;
  return first;
}
function runningMedian() {
  const lower = [], upper = [];
  return {
    add(value) {
      if (!lower.length || value <= lower[0]) push(lower, value, lowerFirst);
      else push(upper, value, upperFirst);
      if (lower.length > upper.length + 1) push(upper, pop(lower, lowerFirst), upperFirst);
      else if (upper.length > lower.length) push(lower, pop(upper, upperFirst), lowerFirst);
    },
    value() {
      // Match median's arithmetic even for an odd large finite duration whose
      // doubled value overflows; do not replace it with the lower root alone.
      return lower.length ? (lower[0] + (lower.length === upper.length ? upper[0] : lower[0])) / 2 : null;
    },
  };
}

function legacyReplay(day, selected, steps, config, following, judge) {
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

/** Replay identical visit decisions without scanning/sorting every prefix at
 * every tick. Visits still get judged in their original selected order, and
 * only completed visits vote for the median. No GPS judgement occurs here. */
export function replayVisitDecisions(day, selected, config, following, judge) {
  const steps = [...new Set(day.flatMap(v => [v.start, v.end]))].sort((x, y) => x - y);
  const ordered = visits => visits.every((v, i) => Number.isFinite(v.start) && Number.isFinite(v.end)
    && Number.isFinite(v.durationMs) && !Object.is(v.durationMs, -0)
    && v.end >= v.start && (!i || v.start >= visits[i - 1].start));
  // Preserve the old public pure helper's unusual-input semantics rather than
  // inventing an ordering/median for malformed or nonchronological visits.
  if (!ordered(day) || !ordered(selected)) return legacyReplay(day, selected, steps, config, following, judge);
  const schedule = visits => {
    const ended = visits.filter(v => v.completed).map((visit, index) => ({ visit, index }))
      .sort((a, b) => a.visit.end - b.visit.end || a.index - b.index);
    const medianOfEnded = runningMedian();
    let startIndex = 0, endIndex = 0;
    return {
      at(tick) {
        while (startIndex < visits.length && visits[startIndex].start <= tick) startIndex += 1;
        const first = endIndex;
        while (endIndex < ended.length && ended[endIndex].visit.end <= tick) {
          medianOfEnded.add(ended[endIndex].visit.durationMs); endIndex += 1;
        }
        return { started: startIndex, typical: medianOfEnded.value(),
          justEnded: ended.slice(first, endIndex).filter(entry => entry.visit.end === tick).map(entry => entry.visit) };
      },
    };
  };
  const daySchedule = schedule(day), ownSchedule = schedule(selected);
  let ready = false, fallback = null, typicalMs = null;
  for (const tick of steps) {
    const own = ownSchedule.at(tick), wholeDay = daySchedule.at(tick);
    const useFallback = (!following && fallback) || own.started < config.minVisits;
    const base = useFallback ? wholeDay : own;
    if (base.started < config.minVisits || base.typical == null) continue;
    const switched = ready && fallback !== useFallback;
    typicalMs = base.typical;
    if (!ready || switched) judge(selected.filter(v => v.end <= tick && (v.completed || v.start <= tick)), base.typical);
    else judge(own.justEnded, base.typical);
    ready = true; fallback = useFallback;
  }
  return { ready, fallback, typicalMs };
}
