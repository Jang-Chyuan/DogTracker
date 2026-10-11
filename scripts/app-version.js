const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const MAX_CODE = 2147483647;

function versionCode(value) {
  const code = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(code) || code < 1 || code > MAX_CODE) {
    throw new Error('APP_VERSION_CODE must be a positive signed 32-bit integer.');
  }
  return code;
}

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
  return { name: `${base.split('.').slice(0, 2).join('.')}.${count}`, code: count };
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
