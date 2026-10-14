// Generate synthetic phone-motion parity; no private recordings are included.
// `node scripts/generate-phone-motion-parity.cjs` rewrites the fixture;
// `--stdout` prints it instead (__tests__/PhoneMotionParityFixture.test.js
// checks the committed fixture is what this script generates).
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const root = path.resolve(__dirname, '..');
const babel = require(path.join(root, 'node_modules/@babel/core'));
const cache = new Map();
function load(file) {
  if (file.endsWith('/i18n')) return { t: id => id };
  if (!path.extname(file)) file += '.js';
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    configFile: false,
    babelrc: false,
    plugins: [
      require(path.join(
        root,
        'node_modules/@babel/plugin-transform-modules-commonjs'
      )),
    ],
  }).code;
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: ref =>
      ref.startsWith('.')
        ? load(path.resolve(path.dirname(file), ref))
        : require(ref),
    console,
    Date,
    Map,
    Set,
    Float64Array,
    Math,
    JSON,
    Number,
    Object,
    Array,
    String,
    Infinity,
  });
  return mod.exports;
}

const { PhoneMotion } = load(
  path.join(root, 'src/locationTracker/PhoneMotion')
);
const cases = [];
// x metres north, y metres east of a fictional origin (PhoneMotionParityTest
// rebuilds the same coordinates).
const point = (t, x, accuracy = 14, speed = 0, sacc = 0.3, y = 0) => ({
  time: Math.round(t * 1000),
  latitude: 25 + x / 111195,
  longitude: 121 + y / 100777,
  accuracy,
  raw_speed_kmh: speed,
  speed_accuracy_mps: sacc,
});
for (const speed of [0.2, 0.4, 0.8]) {
  const tracker = new PhoneMotion();
  for (let t = 1; t <= 21; t++) tracker.accept(point(t, 0));
  let exit = null;
  for (let t = 22; t < 700; t++)
    if (tracker.accept(point(t, (t - 21) * speed)) === 'moving') {
      exit = { seconds: t - 21, metres: (t - 21) * speed };
      break;
    }
  if (!exit || exit.seconds > 360)
    throw new Error('Wrong-zero departure did not escape');
}
for (const name of [
  'parked',
  'walk',
  'wrong-zero',
  'missing',
  'cold-missing',
  'missing-reentry',
  'sparse',
  'dense-wrong-zero',
  'boundary',
]) {
  const tracker = new PhoneMotion(),
    samples = [];
  const step = name === 'sparse' ? 5 : name === 'dense-wrong-zero' ? 0.05 : 1;
  for (let tick = 1; tick <= 400 / step; tick++) {
    const t = Math.round(tick * step * 1000) / 1000;
    const x = name === 'missing-reentry' ? Math.max(0, Math.min(t, 200) - 40) * 0.8
      : name === 'cold-missing' ? t * 0.8 : t < 40 ? 0 : name === 'parked' ? 65 + (t % 2) : (t - 40) * 0.4;
    const p = point(
      t,
      x,
      14,
      name === 'walk' && t >= 40 ? 5 : name === 'boundary' ? 2.16 : 0,
      name === 'walk' || name === 'boundary' ? 0.1 : 0.3
    );
    if (name === 'missing' && t >= 40) p.raw_speed_kmh = null;
    if (name === 'cold-missing') p.raw_speed_kmh = null;
    if (name === 'missing-reentry' && t >= 40 && t <= 200) p.raw_speed_kmh = null;
    samples.push({
      t,
      x,
      accuracy: p.accuracy,
      speed: p.raw_speed_kmh,
      sacc: p.speed_accuracy_mps,
      state: tracker.accept(p),
    });
  }
  cases.push({ name, samples });
}
for (const name of ['after-walk-jitter', 'after-walk-small-drift', 'after-walk-wrong-zero', 'after-walk-no-spread']) {
  const tracker = new PhoneMotion(), samples = [];
  const rows = [];
  for (let t = 1; t <= 21; t += 1) rows.push([t, 0]);
  for (let t = 22; t <= 222; t += 1) rows.push([t, (t - 21) * 0.8]);
  for (let t = 227; t <= 727; t += 5) {
    const i = (t - 227) / 5;
    const offset = name === 'after-walk-jitter' ? (i % 2 ? 12 : -12)
      : name === 'after-walk-small-drift' ? Math.min(i * 5 / 15 * 10, 20) : (t - 222) * (name === 'after-walk-no-spread' ? 0.8 : 0.4);
    rows.push([t, 160.8 + offset]);
  }
  for (const [t, x] of rows) {
    const p = point(t, x, 20, name === 'after-walk-no-spread' && t >= 227 ? 1.8 : 0,
      name === 'after-walk-no-spread' && t >= 227 ? null : 0.4);
    samples.push({ t, x, accuracy: p.accuracy, speed: p.raw_speed_kmh,
      sacc: p.speed_accuracy_mps, state: tracker.accept(p) });
  }
  cases.push({ name, samples });
}
// 2-D fixes at ≤ 10 m, 30–50 m (Wi-Fi-like) and mixed accuracy. Rows are
// [t, x, y, accuracy, speed km/h, speed accuracy m/s].
const jitter = (t, metres, a = 0.37, b = 0.23) => [
  Math.round(metres * Math.sin(t * a) * 100) / 100,
  Math.round(metres * Math.cos(t * b) * 100) / 100,
];
const coarse = t => [35, 40, 45, 48][t % 4];
function run(name, rows) {
  const tracker = new PhoneMotion();
  cases.push({ name, samples: rows.map(([t, x, y, accuracy, speed, sacc]) => {
    // y only when east of the origin, so 1-D rows keep their old shape.
    const row = y ? { t, x, y } : { t, x };
    return Object.assign(row, { accuracy, speed, sacc,
      state: tracker.accept(point(t, x, accuracy, speed, sacc, y)) });
  }) });
}
const series = (from, to, step, row) => {
  const rows = [];
  for (let t = from; t <= to; t += step) rows.push([t, ...row(t)]);
  return rows;
};
// Fine (5 m): still, a measured diagonal walk, still again, then a wrong-zero
// diagonal walk that only geometry can release.
run('fine-2d', [
  ...series(1, 40, 1, t => [...jitter(t, 0.8), 5, 0, 0.3]),
  ...series(41, 140, 1, t => [(t - 40) * 0.85, (t - 40) * 0.85, 5, 4.32, 0.2]),
  ...series(141, 200, 1, t => [85 + jitter(t, 0.8)[0], 85 + jitter(t, 0.8)[1], 5, 0, 0.3]),
  ...series(201, 400, 1, t => [85 + (t - 200) * 0.5, 85 + (t - 200) * 0.5, 5, 0, 0.3]),
]);
// Locked at 20 m, then 30–50 m fixes standing still (some without a speed
// accuracy) keep the stop; a wrong-zero diagonal walk then leaves it.
for (const [name, step] of [['coarse-hold-2d', 1], ['coarse-hold-2d-sparse', 5]]) {
  run(name, [
    ...series(1, 30, 1, t => [...jitter(t, 2), 20, 0, 0.3]),
    ...series(31, 700, step, t => [...jitter(t, 18), coarse(t), 0, t % 7 ? 0.3 : null]),
    ...series(700 + step, 1300, step, t => [(t - 700) * 0.5, (t - 700) * 0.5, 40, 0, 0.3]),
  ]);
}
// Coarse fixes settled 78 m away (beyond the hold radius): no longer kept.
run('coarse-drift-out', [
  ...series(1, 30, 1, t => [...jitter(t, 1), 14, 0, 0.3]),
  ...series(31, 400, 1, t => [60 + jitter(t, 3)[0], 50 + jitter(t, 3)[1], 45, 0, 0.3]),
]);
// A measured 1.2 m/s diagonal walk on coarse fixes leaves within seconds.
run('coarse-measured-walk-2d', [
  ...series(1, 30, 1, t => [...jitter(t, 1), 14, 0, 0.3]),
  ...series(31, 300, 1, t => [(t - 30) * 0.96, (t - 30) * 0.72, 40, 4.32, 0.3]),
]);
// A slow 0.7 m/s walk whose speed reads as still: kept only near the anchor.
run('coarse-slow-walk-2d', [
  ...series(1, 30, 1, t => [...jitter(t, 1), 14, 0, 0.3]),
  ...series(31, 700, 1, t => [(t - 30) * 0.42, (t - 30) * 0.56, 45, 2.52, 0.3]),
]);
// Saved rows (5 or 6 s apart) at ≤ 10 m: the fine window reaches back past
// 20 s. Rows alternate 5 and 6 s from `from`; row(t, i) gives the rest.
const sparse = (from, count, row) => {
  const rows = [];
  for (let i = 0, t = from; i < count; i += 1, t += i % 2 ? 5 : 6) rows.push([t, ...row(t, i)]);
  return rows;
};
// Still, then a 3.6 km/h walk measured ± 0.72 m/s (inside its uncertainty):
// it leaves within half a minute; stop-and-go rounds after it.
run('fine-sparse-slow-walk', [
  ...sparse(1, 30, t => [...jitter(t, 0.3), 3.8, 0, 0.07]),
  ...sparse(166, 60, (t, i) => [(t - 166) * 0.96, (t - 166) * 0.28 + (i % 2) * 0.6, 3.8, 3.6, 0.72]),
  ...sparse(497, 80, (t, i) => {
    const walked = Math.min((t - 497) % 60, 40) + 40 * Math.floor((t - 497) / 60);
    return [316 + walked * 0.9, 92 + walked * 0.4, 3.8, (t - 497) % 60 < 40 ? 3.6 : 0, (t - 497) % 60 < 40 ? 0.72 : 0.07];
  }),
]);
// Still, then indoor runs of 5–6 m a row at a confident zero speed: kept.
run('fine-sparse-drift', [
  ...sparse(1, 30, t => [...jitter(t, 0.3), 3.8, 0, 0.07]),
  ...sparse(166, 120, (t, i) => {
    const burst = Math.floor(i / 20), k = Math.min(i % 20, 4);
    return [burst * 3 + k * 5.5 * Math.cos(burst), k * 5.5 * Math.sin(burst), 3.8, 0, 0.1];
  }),
]);
// A car at 7 m/s every 3 s, then fixes 6 s apart at 1.15 ± 0.76 m/s.
run('fine-sparse-car', [
  ...series(1, 61, 3, t => [t * 7, 0, 4, 25.2, 0.8]),
  ...series(67, 127, 6, t => [427 + (t - 61) * 1.15, 0, 4, 4.14, 0.76]),
]);
// Coarse fixes from the start never confirm a stop.
run('coarse-from-start', series(1, 400, 1, t => [...jitter(t, 15), coarse(t), 0, 0.3]));

const fixture = '[\n' +
    cases
      .map(
        c =>
          '{"name":' +
          JSON.stringify(c.name) +
          ',"samples":[\n' +
          c.samples.map(r => JSON.stringify(r)).join(',\n') +
          '\n]}'
      )
      .join(',\n') +
    '\n]\n';
if (process.argv.includes('--stdout')) process.stdout.write(fixture);
else fs.writeFileSync(
  path.join(root, 'android/app/src/test/resources/phone-motion-parity.json'), fixture);
