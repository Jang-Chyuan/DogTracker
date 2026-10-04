import { fixedPosition, applyHistoryFixedPositions } from '../src/map/FixedPosition';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { historyGeometry } from '../src/mapHistory/HistoryDatabase';
import { createHistoryDatabase, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
const setting = { slave_id: 4, name: '家', latitude: 25, longitude: 121, enabled: true };
const now = 240000;
test('USB overrides environment; indoor and window apply; outdoor and stale results do not', () => {
  expect(fixedPosition(setting, 1, null, now).fixedReason).toContain('充電');
  for (const environment of ['indoor', 'window']) {
    expect(fixedPosition(setting, 0, { environment, observedAt: now - 60000 }, now)).not.toBeNull();
  }
  expect(fixedPosition(setting, 0, { environment: 'outdoor', observedAt: now }, now)).toBeNull();
  expect(fixedPosition(setting, 0, { environment: 'indoor', observedAt: 0 }, now)).toBeNull();
  expect(fixedPosition({ ...setting, enabled: false }, 1, null, now)).toBeNull();
});
test('fresh USB no-fix dog gains a marker; stale packet and unplug restore original GPS handling', () => {
  const point = { slaveId: 4, masterId: 7, slaveLat: 0, slaveLon: 0, usbPresent: 1, receivedAt: now };
  const args = { point, now, windowMs: 120000, fixedLocations: [setting] };
  const dog = mergeDogMarkers(args)[0];
  expect(dog.coordinate).toEqual({ latitude: 25, longitude: 121 });
  expect(dog.stale).toBe(false);
  expect(dog.retained).toBe(false);
  expect(mergeDogMarkers({ ...args, now: now + 120001 })[0].fixedReason).toBeUndefined();
  expect(mergeDogMarkers({ ...args, point: { ...point, usbPresent: 0 } })[0].coordinate).toBeNull();
  expect(point.slaveLat).toBe(0);
});
test('history applies completed minute USB rule to next minute without using future samples', () => {
  const row = (time, usb) => ({ time, usb_present: usb, master_id: 7, slave_id: 4,
    latitude: 26, longitude: 122, raw_latitude: 26, raw_longitude: 122 });
  const points = [row(61000, 1), row(70000, 1), row(121000, 0), row(310000, 0)];
  const output = applyHistoryFixedPositions(points, [setting], 360000);
  expect(output[0].fixedReason).toContain('充電');
  expect(output[2].fixedReason).toBe('室內');
  expect(output[2].latitude).toBe(25);
  expect(output[3].fixedReason).toBeUndefined();
  expect(points[2].latitude).toBe(26);
});
test('history breaks segments when entering or leaving a fixed location', () => {
  const points = [{ time: 1000, latitude: 26, longitude: 122 },
    { time: 2000, latitude: 25, longitude: 121, fixedReason: '室內', fixedName: '家' },
    { time: 3000, latitude: 25, longitude: 121, fixedReason: '室內', fixedName: '家' },
    { time: 4000, latitude: 26, longitude: 122 }];
  expect(historyGeometry(points).segments.map(part => part.length)).toEqual([1, 2, 1]);
});

test('SQLite history reads USB and minute context while leaving stored GPS unchanged', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    for (const [time, usb] of [[61000, 1], [70000, 1], [121000, 0]]) {
      await db.executeAsync('INSERT INTO dog_status(master_id,slave_id,received_at,slave_lat,slave_lon,usb_present) VALUES(7,4,?,26,122,?)', [time, usb]);
    }
    const preferences = { ...HISTORY_DEFAULTS, phone: false, masters: [7], slaves: [4] };
    const history = createHistoryDatabase(db);
    const result = await history.read(preferences, null, 180000, () => true, false,
      { since: 120000, until: 180000 }, [setting]);
    expect(result.clients[0].latest.latitude).toBe(25);
    expect(result.clients[0].latest.fixedReason).toBe('室內');
    expect(result.clients[0].count).toBe(1);
    const raw = await history.read(preferences, null, 180000, () => true, true,
      { since: 120000, until: 180000 }, [setting]);
    expect(raw.clients[0].rows[0].fixedReason).toBeUndefined();
    const stored = await db.executeAsync('SELECT slave_lat FROM dog_status');
    expect(stored.results.every(row => row.slave_lat === 26)).toBe(true);
  } finally { db.close(); }
});
