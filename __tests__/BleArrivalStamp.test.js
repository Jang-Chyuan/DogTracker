/* eslint-env node */
import fs from 'fs';
import path from 'path';

// BleForegroundService.kt: a notification's time is taken in the GATT
// callback, before the handler queue and DogStatusStore's lock, and the
// stored time is that one (not the time the handler got to it).
const source = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/com/dogtracker/BleForegroundService.kt'), 'utf8');

test('each notification is stamped on arrival, before dispatch', () => {
  const callbacks = [...source.matchAll(/override fun onCharacteristicChanged\([^)]*\) \{([\s\S]*?)\n {4}\}/g)].map(match => match[1]);
  expect(callbacks).toHaveLength(2);
  for (const body of callbacks) {
    expect(body.indexOf('Arrival.now()')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('Arrival.now()')).toBeLessThan(body.indexOf('dispatch('));
    expect(body).toContain('receive(bytes, arrival)');
  }
});

test('the stored time is the arrival time', () => {
  const receive = source.match(/private fun receive\(bytes: ByteArray, arrival: Arrival\) \{([\s\S]*?)\n {2}\}/)[1];
  expect(receive).toContain('val now = arrival.wallMs');
  expect(receive).not.toContain('System.currentTimeMillis()');
  expect(receive).toContain('framer.accept(bytes, arrival.elapsedMs)');
});
