const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// android/.../PhoneMotionParityTest replays this fixture through the Kotlin
// MotionDetector. It must be what PhoneMotion.js decides today, so a JS change
// without regenerating (node scripts/generate-phone-motion-parity.cjs) fails.
test('the committed phone-motion parity fixture is what the generator writes', () => {
  const root = path.resolve(__dirname, '..');
  const generated = execFileSync(process.execPath,
    [path.join(root, 'scripts/generate-phone-motion-parity.cjs'), '--stdout'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const committed = fs.readFileSync(
    path.join(root, 'android/app/src/test/resources/phone-motion-parity.json'), 'utf8');
  const cases = JSON.parse(generated);
  // ≤ 10 m, 30–50 m and 2-D motion are all covered.
  const samples = cases.flatMap(c => c.samples);
  expect(samples.some(s => s.accuracy <= 10)).toBe(true);
  expect(samples.some(s => s.accuracy > 30 && s.accuracy < 50 && s.state === 'stationary')).toBe(true);
  expect(samples.some(s => s.y)).toBe(true);
  if (generated !== committed) {
    const differs = cases.find((c, i) => JSON.stringify(c) !== JSON.stringify(JSON.parse(committed)[i]));
    throw new Error(`phone-motion-parity.json is stale (first differing case: ${differs?.name ?? 'count'}); `
      + 'run node scripts/generate-phone-motion-parity.cjs');
  }
});
