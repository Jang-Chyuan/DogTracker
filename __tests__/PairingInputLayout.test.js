import fs from 'fs';

test('E07: the manual name example is outside the input field', () => {
  const source = fs.readFileSync(require.resolve('../src/onboarding/PairingScreen'), 'utf8');
  expect(source).toMatch(/<\/View>\s*<Text testID="pair-name-example"/);
});
