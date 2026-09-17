import { serializeHistory } from '../src/mapHistory/HistoryExport';
import { createHistoryDatabase, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';

test('CSV preserves optional precision and acquisition time, uses BOM and quotes cells', () => {
  const result = serializeHistory('csv', { phone: [{ id: 1, time: 1000, location_at: 900, latitude: 25, longitude: 121, accuracy_meters: 4.5 }], client: [] });
  expect(result.startsWith('\uFEFFsource,')).toBe(true);
  expect(result).toContain('"1970-01-01T00:00:00.900Z"');
  expect(result).toContain('"4.5","","",""');
});

test('GPX separates sources and gaps without simplifying the exported points', () => {
  const point = (time, latitude = 25) => ({ time, latitude, longitude: 121 });
  const result = serializeHistory('gpx', { since: 0, until: 300000,
    phone: [point(0), point(10000), point(20000, null), point(30000), point(200000)], client: [point(0)] });
  expect(result.match(/<trkpt /g)).toHaveLength(5);
  expect(result.match(/<trkseg>/g)).toHaveLength(4);
  expect(result).toContain('<name>phone</name>');
  expect(result).toContain('<name>client</name>');
  expect(result).not.toContain('lat="null"');
});

test('raw export queries full selected interval, not the capped or simplified map geometry', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    const insert = connection.sqlite.prepare('INSERT INTO dog_status(received_at, master_id,slave_id,slave_lat,slave_lon) VALUES(?,7,4,25,121)');
    connection.sqlite.exec('BEGIN');
    for (let i = 1; i <= 4100; i += 1) insert.run(i);
    connection.sqlite.exec('COMMIT');
    const settings = { ...HISTORY_DEFAULTS, phone: false };
    const raw = await history.read(settings, null, 99999999, () => true, true, { since: 1, until: 4101 });
    expect(raw.client).toHaveLength(4100);
    expect(raw.phone).toEqual([]);
    expect(serializeHistory('gpx', raw).match(/<trkpt /g)).toHaveLength(4100);
  } finally { connection.close(); }
});
