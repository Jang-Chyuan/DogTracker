const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const MAX_CODE = 2147483647;
// Outside CI the count stops where HEAD meets main, so an APK from a feature
// branch or worktree never outranks the main/CI APK installed after it.
const LOCAL_BASE_REFS = ['origin/main', 'main'];

function versionCode(value) {
  const code = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(code) || code < 1 || code > MAX_CODE) {
    throw new Error('APP_VERSION_CODE must be a positive signed 32-bit integer.');
  }
  return code;
}

const isCi = env => /^(1|true)$/i.test((env.CI || '').trim());

function resolveAppVersion(root, env = process.env) {
  const name = (env.APP_VERSION_NAME || '').trim();
  const code = (env.APP_VERSION_CODE || '').trim();
  if (Boolean(name) !== Boolean(code)) {
    throw new Error('Supply APP_VERSION_NAME and APP_VERSION_CODE together, or neither.');
  }
  if (name) {
    if (!VERSION.test(name)) throw new Error('APP_VERSION_NAME must be MAJOR.MINOR.PATCH.');
    return { name, code: versionCode(code) };
  }
  const base = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!VERSION.test(base)) throw new Error('package.json version must be MAJOR.MINOR.PATCH.');
  const prefix = base.split('.').slice(0, 2).join('.');
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      throw new Error('Cannot read Git history; supply both APP_VERSION_NAME and APP_VERSION_CODE for a source archive.');
    }
  };
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    throw new Error('Version needs complete Git history: use git fetch --unshallow or checkout fetch-depth: 0.');
  }
  const count = versionCode(git('rev-list', '--count', 'HEAD'));
  // CI and release builds: the full HEAD commit count, exactly as before.
  if (isCi(env)) return { name: `${prefix}.${count}`, code: count };

  let mergeBase = '';
  for (const ref of LOCAL_BASE_REFS) {
    try {
      mergeBase = git('merge-base', 'HEAD', ref);
    } catch {
      continue; // ref missing or unrelated history: try the next one
    }
    if (mergeBase) break;
  }
  // No main to compare with: keep the old HEAD count rather than failing.
  if (!mergeBase) return { name: `${prefix}.${count}`, code: count };
  const baseCount = versionCode(git('rev-list', '--count', mergeBase));
  const ahead = count - baseCount;
  // e.g. 0.3.195+3: built from main's 0.3.195 plus three local commits.
  return { name: `${prefix}.${baseCount}${ahead > 0 ? `+${ahead}` : ''}`, code: baseCount };
}

module.exports = { resolveAppVersion };

if (require.main === module) {
  try {
    const resolved = resolveAppVersion(path.resolve(__dirname, '..'));
    process.stdout.write(process.argv.includes('--github-output')
      ? `name=${resolved.name}\ncode=${resolved.code}\n`
      : `${JSON.stringify(resolved)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
