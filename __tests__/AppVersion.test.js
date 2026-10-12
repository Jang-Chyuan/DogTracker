const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAppVersion, VERSION_CODE_OFFSET, MAX_CODE } = require('../scripts/app-version');

let temporary;
let repository;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const cleanEnv = { ...process.env, APP_VERSION_NAME: '', APP_VERSION_CODE: '' };
const localEnv = { ...cleanEnv, CI: '' };
const ciEnv = { ...cleanEnv, CI: 'true' };

const commit = (root, message) => git(root, '-c', 'user.name=Version Test', '-c', 'user.email=version@example.invalid',
  '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message);

function makeRepository(name, { branch = 'main', commits = 3, originMain = true } = {}) {
  const root = path.join(temporary, name);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  git(root, 'init', '-q', '-b', branch);
  git(root, 'add', 'package.json');
  for (let i = 0; i < commits; i++) commit(root, `independent version fixture ${i}`);
  if (originMain) git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

beforeAll(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dogtracker-version-'));
  repository = makeRepository('full');
});
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('the versionCode offset clears every pre-offset code on test devices and stays below the Android max', () => {
  // Devices already hold codes up to ~280 (phone 280, emulator 203/204) from
  // builds made before the offset; even a one-commit history must outrank them.
  expect(VERSION_CODE_OFFSET).toBe(1000);
  expect(VERSION_CODE_OFFSET + 1).toBeGreaterThan(280);
  expect(MAX_CODE).toBe(2100000000);
});

test('CI uses the full HEAD commit count plus the offset, regardless of package patch', () => {
  expect(resolveAppVersion(repository, ciEnv)).toEqual({ name: '0.3.3', code: 1003 });
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version: '0.3.999' }));
  expect(resolveAppVersion(repository, ciEnv)).toEqual({ name: '0.3.3', code: 1003 });
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version: '0.3.0' }));
});

test('a local build of main gives the same name and code as CI', () => {
  expect(resolveAppVersion(repository, localEnv)).toEqual(resolveAppVersion(repository, ciEnv));
});

test('a local feature branch never outranks the main APK built after it', () => {
  const root = makeRepository('feature');
  git(root, 'checkout', '-q', '-b', 'feature');
  commit(root, 'feature 1');
  commit(root, 'feature 2');
  // CI counts the whole HEAD; locally the code stops at the merge-base. Both add the offset.
  expect(resolveAppVersion(root, ciEnv)).toEqual({ name: '0.3.5', code: 1005 });
  expect(resolveAppVersion(root, localEnv)).toEqual({ name: '0.3.3+2', code: 1003 });

  // main moves on by one merge: its APK (code 1004) must install over the feature APK.
  git(root, 'checkout', '-q', 'main');
  commit(root, 'merged elsewhere');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const mainApk = resolveAppVersion(root, ciEnv);
  expect(mainApk).toEqual({ name: '0.3.4', code: 1004 });
  git(root, 'checkout', '-q', 'feature');
  expect(resolveAppVersion(root, localEnv).code).toBeLessThan(mainApk.code);

  // After the branch merges main in, it matches main's code (same code reinstalls with -r).
  git(root, '-c', 'user.name=Version Test', '-c', 'user.email=version@example.invalid', '-c', 'commit.gpgsign=false',
    'merge', '-q', '--no-edit', 'origin/main');
  expect(resolveAppVersion(root, localEnv)).toEqual({ name: '0.3.4+3', code: 1004 });
});

test('local builds fall back to local main, then to the HEAD count, when origin/main is missing', () => {
  const noRemote = makeRepository('no-remote', { originMain: false });
  git(noRemote, 'checkout', '-q', '-b', 'feature');
  commit(noRemote, 'feature 1');
  expect(resolveAppVersion(noRemote, localEnv)).toEqual({ name: '0.3.3+1', code: 1003 });

  const noMain = makeRepository('no-main', { branch: 'trunk', originMain: false });
  expect(resolveAppVersion(noMain, localEnv)).toEqual({ name: '0.3.3', code: 1003 });
});

test('an actual shallow checkout fails even though git reports a positive commit count', () => {
  const shallow = path.join(temporary, 'shallow');
  git(temporary, 'clone', '-q', '--depth', '2', `file://${repository}`, shallow);
  expect(git(shallow, 'rev-list', '--count', 'HEAD')).toBe('2');
  for (const env of [localEnv, ciEnv]) {
    expect(() => resolveAppVersion(shallow, env)).toThrow('complete Git history');
  }
  expect(resolveAppVersion(shallow, { APP_VERSION_NAME: '0.3.3', APP_VERSION_CODE: '1003' }))
    .toEqual({ name: '0.3.3', code: 1003 });
});

test('an explicit APP_VERSION_CODE override wins as-is, without the offset, in CI and locally', () => {
  for (const env of [ciEnv, localEnv]) {
    expect(resolveAppVersion(repository, { ...env, APP_VERSION_NAME: '0.3.158', APP_VERSION_CODE: '158' }))
      .toEqual({ name: '0.3.158', code: 158 });
  }
  expect(resolveAppVersion(repository, { APP_VERSION_NAME: '0.3.158', APP_VERSION_CODE: String(MAX_CODE) }).code)
    .toBe(MAX_CODE);
});

test('paired CI overrides work without Git, but incomplete or invalid overrides fail', () => {
  const noGit = path.join(temporary, 'source-archive');
  fs.mkdirSync(noGit);
  fs.writeFileSync(path.join(noGit, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  expect(resolveAppVersion(noGit, { APP_VERSION_NAME: ' 0.3.158 ', APP_VERSION_CODE: ' 1158 ' }))
    .toEqual({ name: '0.3.158', code: 1158 });
  expect(() => resolveAppVersion(noGit, localEnv)).toThrow('Cannot read Git history');
  for (const env of [{ APP_VERSION_NAME: '0.3.158' }, { APP_VERSION_CODE: '158' }]) {
    expect(() => resolveAppVersion(repository, env)).toThrow('together');
  }
  for (const value of ['0', '-1', '1.5', 'not-a-code', '2100000001', '2147483648']) {
    expect(() => resolveAppVersion(repository, { APP_VERSION_NAME: '0.3.158', APP_VERSION_CODE: value }))
      .toThrow('APP_VERSION_CODE must be an integer from 1 to 2100000000');
  }
  expect(() => resolveAppVersion(repository, { APP_VERSION_NAME: 'invalid', APP_VERSION_CODE: '158' }))
    .toThrow('MAJOR.MINOR.PATCH');
});

// The project itself may come from a shallow clone or a source archive without
// .git; the CLI check below needs this checkout's full history, so skip it then.
const projectRoot = path.resolve(__dirname, '..');
const projectHasFullHistory = (() => {
  try {
    return git(projectRoot, 'rev-parse', '--show-toplevel') === fs.realpathSync(projectRoot)
      && git(projectRoot, 'rev-parse', '--is-shallow-repository') === 'false';
  } catch {
    return false;
  }
})();

(projectHasFullHistory ? test : test.skip)('the real CLI exposes identical JSON and GitHub outputs from this checked-out HEAD', () => {
  const script = path.join(projectRoot, 'scripts/app-version.js');
  const count = Number(git(projectRoot, 'rev-list', '--count', 'HEAD'));
  for (const [env, expected] of [
    [ciEnv, { name: `0.3.${count}`, code: VERSION_CODE_OFFSET + count }],
    [localEnv, resolveAppVersion(projectRoot, localEnv)],
  ]) {
    const options = { cwd: os.tmpdir(), env, encoding: 'utf8' };
    expect(JSON.parse(execFileSync(process.execPath, [script], options))).toEqual(expected);
    expect(execFileSync(process.execPath, [script, '--github-output'], options))
      .toBe(`name=${expected.name}\ncode=${expected.code}\n`);
  }
});
