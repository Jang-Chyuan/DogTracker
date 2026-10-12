import { sameHistoryInput, createExactHistoryModelCache } from '../src/mapHistory/HistoryExactSnapshot';
test.each(['locationTime', 'raw_latitude', 'raw_speed_kmh'])('own undefined %s differs from absent despite identical JSON', field => {
  const a = { time: 1, latitude: 2, longitude: 3 }, b = { ...a, [field]: undefined };
  expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(sameHistoryInput(a, b)).toBe(false);
});
test('numeric and array/order semantics remain exact', () => {
  expect(sameHistoryInput({ value: NaN }, { value: null })).toBe(false);
  expect(sameHistoryInput({ value: -0 }, { value: 0 })).toBe(false);
  expect(sameHistoryInput([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }])).toBe(false);
  expect(sameHistoryInput({ a: [NaN, undefined, -0] }, { a: [NaN, undefined, -0] })).toBe(true);
});
test('model cache is scoped, preserves option snapshots, and never treats another opaque scope as equal', () => {
  const cache = createExactHistoryModelCache(), scope = {}, rows = [], replayHolds = () => {};
  const subjects = [{ id: 6, subject: 'dog', rows, replayHolds }];
  const options = { dayStart: 0, dayEnd: 10, today: false, now: null, manual: { start: 2, end: 8, following: false }, protagonist: 6, rangeOwner: 6, kept: null };
  const build = jest.fn(() => ({})); const first = cache(['a', scope, 1], subjects, options, build);
  expect(cache(['a', scope, 1], subjects, { ...options, manual: { ...options.manual } }, build)).toBe(first);
  options.manual.end = 9;
  expect(cache(['a', scope, 1], subjects, options, build)).not.toBe(first);
  cache(['a', {}, 1], subjects, options, build);
  cache(['b', scope, 1], subjects, options, build);
  cache(['a', scope, 2], subjects, options, build);
  cache(['a', scope, 2], [{ ...subjects[0], rows: [] }], options, build);
  expect(build).toHaveBeenCalledTimes(6);
});
test.each(['dayStart', 'dayEnd', 'today', 'now', 'manual', 'following', 'closedAt', 'protagonist', 'rangeOwner', 'kept'])('%s model option change cannot reuse an earlier result', field => {
  const cache = createExactHistoryModelCache(), identity = ['a', {}, 1], subjects = [{ id: 6, subject: 'dog', rows: [], replayHolds: () => {} }];
  const options = { dayStart: 0, dayEnd: 10, today: false, now: null, manual: null, following: false,
    closedAt: null, protagonist: 6, rangeOwner: 6, kept: null };
  const build = jest.fn(() => ({})), first = cache(identity, subjects, options, build);
  const changed = { ...options, [field]: ['manual', 'kept'].includes(field) ? { start: 1, end: 8, following: false }
    : typeof options[field] === 'boolean' ? !options[field] : 11 };
  expect(cache(identity, subjects, changed, build)).not.toBe(first); expect(build).toHaveBeenCalledTimes(2);
});
