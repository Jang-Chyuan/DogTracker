/* eslint-env node */
// Run the application's JS database methods in-process against build.mjs's
// retention-cap SQLite fixture. No bridge, device or emulator is involved.
// node --experimental-sqlite scripts/perf-v3.cjs <app.db> <src-root> <output.json>
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const { createHash } = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const babel = require(process.cwd() + '/node_modules/@babel/core');
const source = path.resolve(process.argv[3] || 'src');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!file.endsWith('.js')) file += '.js';
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    babelrc: false, configFile: false,
    presets: [[process.cwd() + '/node_modules/@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  const requireSource = id => {
    if (id === 'react-native') return { Platform: { OS: 'test' }, NativeModules: {} };
    if (id === 'react-native-nitro-sqlite') return { open() { throw Error('Use provided connection'); } };
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id));
    return require(id);
  };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(requireSource, module, module.exports);
  return module.exports;
}
const work = process.argv[4] + '.db';
fs.copyFileSync(process.argv[2], work);
const sql = new DatabaseSync(work);
sql.exec('PRAGMA journal_mode=WAL');
const connection = {
  async executeAsync(query, params = []) { return { results: sql.prepare(query).all(...params) }; },
  async executeBatchAsync(commands) {
    sql.exec('SAVEPOINT batch');
    try { for (const { query, params = [] } of commands) sql.prepare(query).run(...params); sql.exec('RELEASE batch'); }
    catch (error) { sql.exec('ROLLBACK TO batch'); sql.exec('RELEASE batch'); throw error; }
  },
};
const { createDogDatabase } = load(path.join(source, 'database/DogDatabase'));
const { createCloudDatabase } = load(path.join(source, 'cloud/CloudDatabase'));
const dog = createDogDatabase(connection), cloud = createCloudDatabase(connection);
const owner = 'fb96978f-cfc2-403c-bbfc-ffdf3bc7b25e';
const now = Date.parse('2026-10-09T12:00:00+08:00');
const hash = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const results = { sqlite: sql.prepare('SELECT sqlite_version() v').get().v, rows: {}, cases: [] };
for (const table of ['dog_status','supabase_dog_status','myLocationTracker','ble_upload_queue']) results.rows[table] = sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
async function measure(id, work, rollback = false) {
  if (process.env.BENCH_CASES && !process.env.BENCH_CASES.split(',').includes(id)) return;
  const times = []; let outcome;
  for (let i = 0; i < 6; i++) {
    if (rollback) sql.exec('SAVEPOINT sample');
    const start = performance.now(); outcome = await work(); times.push(performance.now() - start);
    if (rollback) sql.exec('ROLLBACK TO sample; RELEASE sample');
  }
  const warm = times.slice(1).sort((a,b) => a-b)[2];
  const record = { id, firstMs: +times[0].toFixed(3), warmMs: +warm.toFixed(3), hash: hash(outcome) };
  results.cases.push(record); console.log(record);
}
async function poll() {
  const latest = await cloud.latestBySlave(owner, 0);
  const status = await cloud.latestStatusRows(owner, 0, now);
  const max = table => sql.prepare(`SELECT MAX(id) n FROM ${table}`).get().n;
  const hold = await cloud.holdRows(owner, now - 1800000,
    { dog_status: max('dog_status') - 10, supabase_dog_status: max('supabase_dog_status') - 10, repairs: 0 });
  return { latest, status, hold };
}
async function window() {
  const latest = await dog.getLatestStatusRow();
  const context = await dog.getLatestValidStatusRows(latest.master_id, latest.slave_id, latest.id);
  const ids = []; let cursor = [null,null];
  for (;;) {
    const page = await dog.listLatestStatusRowsByTimeCursor(latest.received_at - 86400000, latest.received_at, ...cursor, 1000);
    ids.push(...page.map(r => r.id));
    if (page.length < 1000) break;
    const last = page.at(-1); cursor = [last.received_at,last.id];
  }
  return { context, ids };
}
async function tick() {
  const latest = await dog.getLatestStatusRow();
  // Force the latest row's display computation each sample (rolled back).
  sql.prepare('UPDATE dog_status SET display_version=NULL WHERE id=?').run(latest.id);
  return dog.displayRows([latest]);
}
(async () => {
  await dog.initialize();
  await measure('dogs.poll', poll);
  await measure('open.liveWindow', window);
  await measure('feed.tick.beforeStatistics', tick, true);
  const start = performance.now(); await cloud.initialize();
  results.initializeFirstMs = +(performance.now() - start).toFixed(3);
  await measure('sync.initialize.repeat', () => cloud.initialize());
  await measure('feed.tick.afterInitialize', tick, true);
  sql.exec('ANALYZE');
  await measure('feed.tick.afterAnalyze', tick, true);
  await measure('dogs.poll.afterAnalyze', poll);
  await measure('open.liveWindow.afterAnalyze', window);
  fs.writeFileSync(process.argv[4], JSON.stringify(results,null,2) + '\n'); sql.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
