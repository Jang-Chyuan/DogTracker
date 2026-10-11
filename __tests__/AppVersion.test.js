const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAppVersion } = require('../scripts/app-version');

let temporary;
let repository;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const cleanEnv = { ...process.env, APP_VERSION_NAME: '', APP_VERSION_CODE: '' };

beforeAll(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dogtracker-version-'));
  repository = path.join(temporary, 'full');
  fs.mkdirSync(repository);
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  git(repository, 'init', '-q');
  git(repository, 'add', 'package.json');
  for (let i = 0; i < 3; i++) {
    git(repository, '-c', 'user.name=Version Test', '-c', 'user.email=version@example.invalid',
      'commit', '-q', '--allow-empty', '-m', `independent version fixture ${i}`);
  }
});
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('full Git history gives local and CI the same name and code, regardless of package patch', () => {
  expect(resolveAppVersion(repository, cleanEnv)).toEqual({ name: '0.3.3', code: 3 });
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version: '0.3.999' }));
  expect(resolveAppVersion(repository, cleanEnv)).toEqual({ name: '0.3.3', code: 3 });
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version: '0.3.0' }));
});

test('an actual shallow checkout fails even though git reports a positive commit count', () => {
  const shallow = path.join(temporary, 'shallow');
  git(temporary, 'clone', '-q', '--depth', '2', `file://${repository}`, shallow);
  expect(git(shallow, 'rev-list', '--count', 'HEAD')).toBe('2');
  expect(() => resolveAppVersion(shallow, cleanEnv)).toThrow('complete Git history');
  expect(resolveAppVersion(shallow, { APP_VERSION_NAME: '0.3.3', APP_VERSION_CODE: '3' }))
    .toEqual({ name: '0.3.3', code: 3 });
});

test('paired CI overrides work without Git, but incomplete or invalid overrides fail', () => {
  const noGit = path.join(temporary, 'source-archive');
  fs.mkdirSync(noGit);
  fs.writeFileSync(path.join(noGit, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  expect(resolveAppVersion(noGit, { APP_VERSION_NAME: ' 0.3.158 ', APP_VERSION_CODE: ' 158 ' }))
    .toEqual({ name: '0.3.158', code: 158 });
  expect(() => resolveAppVersion(noGit, cleanEnv)).toThrow('Cannot read Git history');
  for (const env of [{ APP_VERSION_NAME: '0.3.158' }, { APP_VERSION_CODE: '158' }]) {
    expect(() => resolveAppVersion(repository, env)).toThrow('together');
  }
  for (const value of ['0', '-1', '1.5', 'not-a-code', '2147483648']) {
    expect(() => resolveAppVersion(repository, { APP_VERSION_NAME: '0.3.158', APP_VERSION_CODE: value }))
      .toThrow('positive signed 32-bit integer');
  }
  expect(() => resolveAppVersion(repository, { APP_VERSION_NAME: 'invalid', APP_VERSION_CODE: '158' }))
    .toThrow('MAJOR.MINOR.PATCH');
});

test('the real CLI exposes identical JSON and GitHub outputs from this checked-out HEAD', () => {
  const root = path.resolve(__dirname, '..');
  const script = path.join(root, 'scripts/app-version.js');
  const options = { cwd: os.tmpdir(), env: cleanEnv, encoding: 'utf8' };
  const count = Number(git(root, 'rev-list', '--count', 'HEAD'));
  const expected = { name: `0.3.${count}`, code: count };
  expect(JSON.parse(execFileSync(process.execPath, [script], options))).toEqual(expected);
  expect(execFileSync(process.execPath, [script, '--github-output'], options))
    .toBe(`name=${expected.name}\ncode=${expected.code}\n`);
});
