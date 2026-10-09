import fs from 'fs';
import * as merge from '../src/map/DogMerge';

test('K19: legacy export no longer synchronizes history preferences or exports unused helpers', () => {
  const source = fs.readFileSync(require.resolve('../src/screens/MapScreen'), 'utf8');
  expect(source).not.toContain('screen.source');
  expect(source).not.toContain('const exportDogs');
  for (const name of ['describeDogSource', 'heldLabel', 'heldSentence']) expect(merge[name]).toBeUndefined();
});
