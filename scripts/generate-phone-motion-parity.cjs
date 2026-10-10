// Generate synthetic phone-motion parity; no private recordings are included.
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
const point = (t, x, accuracy = 14, speed = 0, sacc = 0.3) => ({
  time: Math.round(t * 1000),
  latitude: 25 + x / 111195,
  longitude: 121,
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
fs.writeFileSync(
  path.join(root, 'android/app/src/test/resources/phone-motion-parity.json'),
  '[\n' +
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
    '\n]\n'
);
