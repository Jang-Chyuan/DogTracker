import fs from 'fs';

test('X1: an enabled running recording service requests sticky restart; stopped and failed starts do not', () => {
  const source = fs.readFileSync(require.resolve('../android/app/src/main/java/com/dogtracker/location/LocationTrackerService.kt'), 'utf8');
  expect(source).toContain('if (running) return START_STICKY');
  expect(source).toContain('return if (running) START_STICKY else START_NOT_STICKY');
  expect(source).toMatch(/!preferences.getBoolean\("enabled", true\).*START_NOT_STICKY/);
  expect(source).toMatch(/action == "STOP"[\s\S]*?stopSelf\(\); return START_NOT_STICKY/);
});
