// S07 「release 的 logcat 不留可以辨識使用者的東西」: react-native-keychain
// logs every missing entry with its service name ("No entry found for
// service: com.dogtracker.supabase.sb-<project ref>-auth-token", 42 times in a
// release run, lane C 061c/061d O1) and exception messages, also in release.
// patches/react-native-keychain+<version>.patch routes every android.util.Log
// call of the library through KeychainLog, silent unless the app is
// debuggable (DOGTRACKER_KEYCHAIN_LOG). This checks that the patch is there,
// matches the installed version, and has been applied to every Kotlin/Java
// source the Android build compiles.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const MARK = 'DOGTRACKER_KEYCHAIN_LOG';
const keychainPackage = require('react-native-keychain/package.json');
const patchFile = path.join(
  root,
  'patches',
  `react-native-keychain+${keychainPackage.version}.patch`,
);
const sourceRoot = path.join(
  path.dirname(require.resolve('react-native-keychain/package.json')),
  'android/src/main/java/com/oblador/keychain',
);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.(kt|java)$/.test(entry.name) ? [file] : [];
  });
}

test('the react-native-keychain patch exists for the installed version', () => {
  const patch = fs.readFileSync(patchFile, 'utf8');
  expect(patch).toContain(MARK);
  expect(patch).toContain('com/oblador/keychain/KeychainLog.kt');
  expect(patch).toContain('com/oblador/keychain/KeychainModule.kt');
  expect(patch).not.toMatch(/^diff --git .*\/build\//m);
});

test('KeychainLog prints only in a debuggable app', () => {
  const log = fs.readFileSync(path.join(sourceRoot, 'KeychainLog.kt'), 'utf8');
  expect(log).toContain(MARK);
  expect(log).toMatch(/@Volatile var enabled = false/);
  expect(log).toMatch(/ApplicationInfo\.FLAG_DEBUGGABLE/);
  for (const level of ['d', 'i', 'w', 'e'])
    expect(log).toMatch(new RegExp(`fun ${level}\\([^)]*\\): Int =\\s*if \\(enabled\\) android\\.util\\.Log\\.${level}\\(`));
  const module = fs.readFileSync(path.join(sourceRoot, 'KeychainModule.kt'), 'utf8');
  const init = module.slice(module.indexOf('  init {'));
  expect(init).toMatch(/^ {2}init \{\s*\/\/[^\n]*\n\s*Log\.init\(reactContext\.applicationInfo\)/);
});

test('no installed keychain source logs through android.util.Log directly', () => {
  const files = sources(sourceRoot);
  expect(files.length).toBeGreaterThan(5);
  for (const file of files) {
    if (file.endsWith('KeychainLog.kt')) continue;
    const source = fs.readFileSync(file, 'utf8');
    expect({ file, direct: /android\.util\.Log\b/.test(source) }).toEqual({ file, direct: false });
    if (/\bLog\.[a-z]+\(/.test(source))
      expect({ file, routed: source.includes('import com.oblador.keychain.KeychainLog as Log') })
        .toEqual({ file, routed: true });
  }
});
